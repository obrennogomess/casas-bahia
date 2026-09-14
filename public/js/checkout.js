(function () {
  "use strict";

  function formatBRL(value) {
    return "R$ " + value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function ckEscape(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Rastreamento completo para a UTMify: pega da URL e cai pro localStorage
  // (onde o script da UTMify guarda os utm_*).
  function collectTracking() {
    var url = new URLSearchParams(window.location.search);
    function pick(k) {
      var v = url.get(k);
      if (v) return v;
      try { v = localStorage.getItem(k); } catch (e) { v = null; }
      return v || "";
    }
    return {
      utm_source: pick("utm_source"),
      utm_medium: pick("utm_medium"),
      utm_campaign: pick("utm_campaign"),
      utm_content: pick("utm_content"),
      utm_term: pick("utm_term"),
      src: pick("src"),
      sck: pick("sck")
    };
  }

  var params = new URLSearchParams(window.location.search);
  var productTitle = params.get("title") || "Item arrematado";
  var productPrice = parseFloat(params.get("price"));
  var productImg = params.get("img") || "";

  // MODO CARRINHO: se há itens no carrinho, o checkout cobra todos juntos.
  // (o fluxo antigo de item único via parâmetros continua funcionando quando
  //  o carrinho está vazio).
  var cartItems = (window.Cart && window.Cart.count() > 0) ? window.Cart.all() : null;
  var cartMode = !!cartItems;
  if (cartItems) {
    productPrice = window.Cart.total();
    productTitle = cartItems.map(function (i) {
      return i.title + (i.back ? " [BACK]" : "");
    }).join(" + ");
    productImg = cartItems[0].img || "";
  }

  // SMOKE TEST: com ?smoketest=1 na URL, a cobrança vira R$ 5,00 (em vez do valor
  // arrematado). Serve para testar o fluxo de pagamento real de ponta a ponta —
  // Pix gerado, pago e redirecionamento pro upsell — gastando só R$ 5.
  // Como isto sobrescreve productPrice, o resumo, o valor do Pix e a cobrança
  // enviada à Mangofy ficam todos em R$ 5,00 automaticamente.
  if (params.get("smoketest") === "1") {
    productPrice = 5;
    console.warn("[checkout] SMOKE TEST ativo: cobrando R$ 5,00 em vez do valor real.");
  }

  var ckProductImg = document.getElementById("ckProductImg");
  var ckProductTitle = document.getElementById("ckProductTitle");
  var ckSummaryPrice = document.getElementById("ckSummaryPrice");

  if (ckProductImg) {
    ckProductImg.src = productImg;
    ckProductImg.alt = productTitle;
  }
  if (ckProductTitle) ckProductTitle.textContent = productTitle;
  if (ckSummaryPrice) ckSummaryPrice.textContent = isNaN(productPrice) ? "R$ 0,00" : formatBRL(productPrice);

  // Resumo em modo carrinho: (re)renderiza os itens, permite remover e recalcula.
  function refreshCart() {
    var list = (window.Cart && window.Cart.count() > 0) ? window.Cart.all() : [];
    if (!list.length) {
      // Carrinho esvaziado pelo usuário → volta pra loja (a menos que o Pix já
      // tenha sido gerado, para não interromper um pagamento em andamento).
      if (cartMode && !pixPending) window.location.href = getUrlWithUtm("index.html");
      return;
    }
    productPrice = window.Cart.total();
    productTitle = list.map(function (i) { return i.title + (i.back ? " [BACK]" : ""); }).join(" + ");
    productImg = list[0].img || "";

    var single = document.getElementById("ckSingleProduct");
    if (single) single.hidden = true;
    var box = document.getElementById("ckCartItems");
    if (box) {
      box.hidden = false;
      box.innerHTML = list.map(function (i) {
        return '<div class="checkout__item">' +
          '<img src="' + ckEscape(i.img) + '" alt="">' +
          '<div class="checkout__item-info"><p>' + ckEscape(i.title) +
            (i.back ? ' <span class="ck-back">[BACK]</span>' : '') + '</p>' +
          '<p class="checkout__item-price">' + formatBRL(i.price) + '</p></div>' +
          '<button type="button" class="checkout__item-remove" data-slug="' + ckEscape(i.slug) + '" aria-label="Remover item">' +
            '<svg width="15" height="15"><use href="#icon-close"/></svg></button>' +
        '</div>';
      }).join("");
    }
    var lbl = document.getElementById("ckSubtotalLabel");
    if (lbl) lbl.textContent = "Subtotal (" + list.length + (list.length > 1 ? " itens)" : " item)");
    if (ckSummaryPrice) ckSummaryPrice.textContent = formatBRL(productPrice);
    if (typeof updateFreteSummary === "function") updateFreteSummary();
  }

  if (cartMode) {
    refreshCart();
    var ckItemsEl = document.getElementById("ckCartItems");
    if (ckItemsEl) {
      ckItemsEl.addEventListener("click", function (e) {
        var btn = e.target.closest(".checkout__item-remove");
        if (!btn || !window.Cart) return;
        window.Cart.remove(btn.getAttribute("data-slug")); // dispara cart:change → refreshCart
      });
    }
    // Mantém o resumo em sincronia se o item for removido pela gaveta lateral.
    window.addEventListener("cart:change", refreshCart);
  }

  /* ---------- Identificador do pedido ----------
     Criado ao abrir o checkout e reaproveitado como external_id da
     transacao, para a xTracky agrupar initiate_checkout, waiting_payment
     e paid sob o mesmo pedido. */
  function getOrderId() {
    var key = "arremata_order_id";
    var id;
    try { id = sessionStorage.getItem(key); } catch (e) { id = null; }
    if (!id) {
      id = "arremata-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
      try { sessionStorage.setItem(key, id); } catch (e) { /* modo privado */ }
    }
    return id;
  }
  var orderId = getOrderId();

  /* ---------- Inicio de checkout (xTracky) ---------- */
  (function notifyCheckoutStarted() {
    if (isNaN(productPrice) || productPrice <= 0) return;
    var attribution = window.getAttribution ? window.getAttribution() : {};
    fetch("/api/checkout/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: orderId,
        price: productPrice,
        source: attribution.source,
        medium: attribution.medium,
        campaign: attribution.campaign,
      }),
      keepalive: true,
    }).catch(function () { /* rastreamento nunca bloqueia o checkout */ });

    if (typeof gtag === "function") {
      gtag("event", "conversion", {
        send_to: "AW-18375685275/vxGrCIak7-gcEJvpmrpE",
        transaction_id: orderId,
      });
      gtag("event", "conversion", {
        send_to: "AW-18414458230/BmLWCJrYhukcEPaq2cxE",
        transaction_id: orderId,
      });
    }
  })();

  /* ---------- "Filled" indicator on every field ---------- */
  function markFilled(input) {
    var field = input.closest(".checkout__field");
    if (!field) return;
    field.classList.toggle("is-filled", input.value.trim() !== "");
  }

  var allCheckoutInputs = Array.prototype.slice.call(document.querySelectorAll(".checkout__field input"));
  allCheckoutInputs.forEach(function (input) {
    input.addEventListener("input", function () { markFilled(input); });
    input.addEventListener("blur", function () { markFilled(input); });
  });

  /* ---------- CPF mask ---------- */
  var ckCpf = document.getElementById("ckCpf");
  if (ckCpf) {
    ckCpf.addEventListener("input", function () {
      var digits = ckCpf.value.replace(/\D/g, "").slice(0, 11);
      var formatted = digits;
      if (digits.length > 9) formatted = digits.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, "$1.$2.$3-$4");
      else if (digits.length > 6) formatted = digits.replace(/(\d{3})(\d{3})(\d{1,3})/, "$1.$2.$3");
      else if (digits.length > 3) formatted = digits.replace(/(\d{3})(\d{1,3})/, "$1.$2");
      ckCpf.value = formatted;
    });
  }

  /* ---------- Phone mask ---------- */
  var ckPhone = document.getElementById("ckPhone");
  if (ckPhone) {
    ckPhone.addEventListener("input", function () {
      var digits = ckPhone.value.replace(/\D/g, "").slice(0, 11);
      var formatted = digits;
      if (digits.length > 10) formatted = digits.replace(/(\d{2})(\d{5})(\d{1,4})/, "($1) $2-$3");
      else if (digits.length > 6) formatted = digits.replace(/(\d{2})(\d{4})(\d{1,4})/, "($1) $2-$3");
      else if (digits.length > 2) formatted = digits.replace(/(\d{2})(\d{1,5})/, "($1) $2");
      else if (digits.length > 0) formatted = digits.replace(/(\d{1,2})/, "($1");
      ckPhone.value = formatted;
    });
  }

  /* ---------- CEP: auto-fill address, no button needed ---------- */
  var ckCep = document.getElementById("ckCep");
  var ckCepFeedback = document.getElementById("ckCepFeedback");
  var ckStreet = document.getElementById("ckStreet");
  var ckNeighborhood = document.getElementById("ckNeighborhood");
  var ckCity = document.getElementById("ckCity");

  /* ---------- Frete: opções aparecem depois do CEP ---------- */
  var ckFreteSection = document.getElementById("ckFreteSection");
  var ckSummaryFrete = document.getElementById("ckSummaryFrete");
  var ckSummaryTotal = document.getElementById("ckSummaryTotal");
  var freightRadios = document.querySelectorAll('input[name="ckFrete"]');

  function selectedFreight() {
    var checked = document.querySelector('input[name="ckFrete"]:checked');
    var v = checked ? parseFloat(checked.value) : 0;
    return isNaN(v) ? 0 : v;
  }
  // Total cobrado = valor do produto + frete escolhido (arredondado a 2 casas
  // para não enviar resíduo de ponto flutuante na cobrança do Pix).
  function orderTotal() {
    var total = (isNaN(productPrice) ? 0 : productPrice) + selectedFreight();
    return Math.round(total * 100) / 100;
  }
  function updateFreteSummary() {
    var f = selectedFreight();
    if (ckSummaryFrete) {
      if (f > 0) {
        ckSummaryFrete.textContent = formatBRL(f);
        ckSummaryFrete.classList.remove("checkout__free-shipping");
      } else {
        ckSummaryFrete.textContent = "Grátis";
        ckSummaryFrete.classList.add("checkout__free-shipping");
      }
    }
    if (ckSummaryTotal) ckSummaryTotal.textContent = formatBRL(orderTotal());
  }
  Array.prototype.forEach.call(freightRadios, function (r) {
    r.addEventListener("change", updateFreteSummary);
  });
  updateFreteSummary();

  function lookupCep(digits) {
    ckCepFeedback.textContent = "Buscando endereço...";
    ckCepFeedback.className = "checkout__cep-feedback";

    fetch("https://viacep.com.br/ws/" + digits + "/json/")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.erro) {
          ckCepFeedback.textContent = "CEP não encontrado. Preencha o endereço manualmente.";
          ckCepFeedback.className = "checkout__cep-feedback is-error";
          return;
        }
        if (ckStreet) { ckStreet.value = data.logradouro || ""; markFilled(ckStreet); }
        if (ckNeighborhood) { ckNeighborhood.value = data.bairro || ""; markFilled(ckNeighborhood); }
        if (ckCity) { ckCity.value = [data.localidade, data.uf].filter(Boolean).join(" - "); markFilled(ckCity); }
        ckCepFeedback.textContent = "Endereço preenchido automaticamente! Confirme o número e complemento.";
        ckCepFeedback.className = "checkout__cep-feedback is-success";
        var numberField = document.getElementById("ckNumber");
        if (numberField) numberField.focus();
      })
      .catch(function () {
        ckCepFeedback.textContent = "Não foi possível buscar o CEP agora. Preencha manualmente.";
        ckCepFeedback.className = "checkout__cep-feedback is-error";
      });
  }

  if (ckCep) {
    ckCep.addEventListener("input", function () {
      var digits = ckCep.value.replace(/\D/g, "").slice(0, 8);
      ckCep.value = digits.length > 5 ? digits.slice(0, 5) + "-" + digits.slice(5) : digits;
      ckCepFeedback.textContent = "";
      ckCepFeedback.className = "checkout__cep-feedback";
      if (digits.length === 8) {
        if (ckFreteSection) ckFreteSection.hidden = false;
        lookupCep(digits);
      }
    });
  }

  /* ---------- Submit: create the Pix charge ---------- */
  var checkoutForm = document.getElementById("checkoutForm");
  var checkoutBlock = document.getElementById("checkoutBlock");
  var checkoutSubmitBtn = document.getElementById("checkoutSubmitBtn");
  var checkoutSubmitError = document.getElementById("checkoutSubmitError");

  var pixBlock = document.getElementById("pixBlock");
  var pixStageLoading = document.getElementById("pixStageLoading");
  var pixStageReady = document.getElementById("pixStageReady");
  var pixStageApproved = document.getElementById("pixStageApproved");
  var pixStageFailed = document.getElementById("pixStageFailed");
  var pixAmount = document.getElementById("pixAmount");
  var pixQrImg = document.getElementById("pixQrImg");
  var pixCode = document.getElementById("pixCode");
  var pixCopyBtn = document.getElementById("pixCopyBtn");
  var pixFailedReason = document.getElementById("pixFailedReason");
  var pixRetryBtn = document.getElementById("pixRetryBtn");
  var ckOrderNumber = document.getElementById("ckOrderNumber");
  var pixProductName = document.getElementById("pixProductName");
  var tMin1 = document.getElementById("tMin1");
  var tMin2 = document.getElementById("tMin2");
  var tSec1 = document.getElementById("tSec1");
  var tSec2 = document.getElementById("tSec2");

  var pollTimer = null;
  var countdownTimer = null;
  var PIX_EXPIRY_MS = 10 * 60 * 1000;
  // So os botoes do cabecalho mostram o aviso de "vai perder a aprovacao"
  // enquanto o Pix desta tela estiver pendente (nao antes, nem depois).
  var pixPending = false;

  function showPixStage(stage) {
    [pixStageLoading, pixStageReady, pixStageApproved, pixStageFailed].forEach(function (s) {
      if (s) s.hidden = s !== stage;
    });
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  function startCountdown() {
    stopCountdown();
    if (!tMin1) return;
    var deadline = Date.now() + PIX_EXPIRY_MS;

    function tick() {
      var msLeft = deadline - Date.now();
      if (msLeft <= 0) {
        stopCountdown();
        stopPolling();
        pixPending = false;
        pixFailedReason.textContent = "O tempo de 10 minutos para pagamento expirou. Você pode gerar um novo Pix.";
        showPixStage(pixStageFailed);
        return;
      }
      var totalSeconds = Math.ceil(msLeft / 1000);
      var minutes = Math.floor(totalSeconds / 60);
      var seconds = totalSeconds % 60;
      var mm = (minutes < 10 ? "0" : "") + minutes;
      var ss = (seconds < 10 ? "0" : "") + seconds;
      tMin1.textContent = mm[0]; tMin2.textContent = mm[1];
      tSec1.textContent = ss[0]; tSec2.textContent = ss[1];
    }

    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function pollStatus(transactionId, slug, amount) {
    stopPolling();
    var query = new URLSearchParams({ slug: slug || "", amount: isNaN(amount) ? "0" : amount });
    // Guarda o primeiro status visto (o de "aguardando pagamento"). A partir daí,
    // QUALQUER mudança de status significa que o pagamento saiu do estado inicial
    // -> redireciona para o upsell. Não checamos se é "paid"/"approved"/etc.,
    // porque a Mangofy pode usar outra palavra para o status aprovado.
    var initialStatus = null;
    pollTimer = setInterval(function () {
      // "_" com timestamp fura o cache: garante que cada consulta seja única e
      // nunca volte 304 (resposta velha em cache travando o status em PENDING).
      var url = "/api/pix/status/" + encodeURIComponent(transactionId) + "?" + query.toString() + "&_=" + Date.now();
      fetch(url, { cache: "no-store" })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          // Ignora respostas de erro transitório (rawStatus ausente): não contam
          // como mudança, evitando redirecionar por engano numa falha de rede.
          var raw = data.rawStatus;
          if (raw == null || raw === "") return;
          var current = String(raw).toLowerCase();

          if (initialStatus === null) { initialStatus = current; return; }

          if (current !== initialStatus) {
            stopPolling();
            stopCountdown();
            pixPending = false;
            if (window.Cart) window.Cart.clear();
            window.location.href = getUrlWithUtm("ups/up1/index.html");
          }
        })
        .catch(function () { /* keep polling silently on transient network errors */ });
    }, 4000);
  }

  if (checkoutForm) {
    checkoutForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!checkoutForm.checkValidity()) {
        checkoutForm.reportValidity();
        return;
      }

      checkoutSubmitBtn.disabled = true;
      checkoutSubmitBtn.textContent = "Gerando pagamento...";
      checkoutSubmitError.hidden = true;

      var slugMatch = productImg.match(/img\/products\/([a-z0-9-]+)\//);

      var attribution = window.getAttribution ? window.getAttribution() : {};

      var buyer = {
        name: document.getElementById("ckName").value.trim(),
        email: document.getElementById("ckEmail").value.trim(),
        cpf: document.getElementById("ckCpf").value,
        phone: document.getElementById("ckPhone").value,
      };
      // Guarda o comprador para os upsells (ups/up1, ups/up2) reutilizarem o
      // mesmo CPF/dados ao gerar novas cobranças Pix na Mangofy.
      try { localStorage.setItem("arremata_buyer", JSON.stringify(buyer)); } catch (e) { /* modo privado */ }

      fetch("/api/pix/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderId,
          slug: slugMatch ? slugMatch[1] : "",
          title: productTitle,
          price: orderTotal(),
          name: buyer.name,
          email: buyer.email,
          cpf: buyer.cpf,
          phone: buyer.phone,
          cep: ckCep.value,
          street: ckStreet.value,
          number: document.getElementById("ckNumber").value,
          complement: document.getElementById("ckComplement").value,
          neighborhood: ckNeighborhood.value,
          city: ckCity.value,
          source: attribution.source,
          medium: attribution.medium,
          campaign: attribution.campaign,
          tracking: collectTracking(),
          gclid: new URLSearchParams(window.location.search).get("gclid") || "",
        }),
      })
        .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
        .then(function (result) {
          checkoutSubmitBtn.disabled = false;
          checkoutSubmitBtn.textContent = "Finalizar pedido";

          if (!result.ok) {
            checkoutSubmitError.textContent = result.data.error || "Não foi possível gerar o pagamento agora. Tente novamente.";
            checkoutSubmitError.hidden = false;
            return;
          }

          if (checkoutBlock) checkoutBlock.hidden = true;
          if (pixBlock) pixBlock.hidden = false;
          window.scrollTo({ top: 0, behavior: "smooth" });

          var checkoutMainTitle = document.getElementById("checkoutMainTitle");
          var checkoutMainSub = document.getElementById("checkoutMainSub");
          if (checkoutMainTitle) {
            checkoutMainTitle.textContent = "Falta apenas finalizar o pagamento via Pix";
            checkoutMainTitle.classList.add("is-pix-mode");
          }
          if (checkoutMainSub) {
            checkoutMainSub.textContent = "Copie o código abaixo e cole no app do seu banco para concluir.";
            checkoutMainSub.classList.add("is-pix-mode");
          }

          if (ckOrderNumber) ckOrderNumber.textContent = result.data.externalId;
          if (pixAmount) pixAmount.textContent = formatBRL(orderTotal());
          if (pixProductName) pixProductName.textContent = productTitle;
          if (pixQrImg) pixQrImg.src = result.data.qrDataUrl;
          if (pixCode) pixCode.value = result.data.payload;

          showPixStage(pixStageReady);
          pixPending = true;
          pollStatus(result.data.id, slugMatch ? slugMatch[1] : "", orderTotal());
          startCountdown();

          if (typeof gtag === "function") {
            gtag("event", "conversion", {
              send_to: "AW-18375685275/EVBtCJDA7-gcEJvpmrpE",
              transaction_id: orderId,
            });
            gtag("event", "conversion", {
              send_to: "AW-18414458230/iHrTCNnhhukcEPaq2cxE",
              transaction_id: orderId,
            });
          }
        })
        .catch(function (err) {
          console.error("Erro ao gerar pagamento Pix:", err);
          checkoutSubmitBtn.disabled = false;
          checkoutSubmitBtn.textContent = "Finalizar pedido";
          checkoutSubmitError.textContent = "Não foi possível conectar ao servidor de pagamento.";
          checkoutSubmitError.hidden = false;
        });
    });
  }

  var copyPopupOverlay = document.getElementById("copyPopupOverlay");

  if (pixCopyBtn) {
    var pixCopyIcon = pixCopyBtn.querySelector("use");
    var pixCopyLabel = pixCopyBtn.querySelector("span");
    pixCopyBtn.addEventListener("click", function () {
      pixCode.select();
      navigator.clipboard.writeText(pixCode.value).then(function () {
        pixCopyLabel.textContent = "Código copiado!";
        pixCopyIcon.setAttribute("href", "#icon-check");
        pixCopyBtn.classList.add("is-copied");
        setTimeout(function () {
          pixCopyLabel.textContent = "Copiar código Pix";
          pixCopyIcon.setAttribute("href", "#icon-copy");
          pixCopyBtn.classList.remove("is-copied");
        }, 2000);
        if (copyPopupOverlay) copyPopupOverlay.classList.add("is-open");
      });
    });
  }

  if (pixRetryBtn) {
    pixRetryBtn.addEventListener("click", function () {
      stopPolling();
      stopCountdown();
      pixPending = false;
      showPixStage(null);
      if (pixBlock) pixBlock.hidden = true;
      if (checkoutBlock) checkoutBlock.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- Aviso ao tentar sair com Pix pendente ---------- */
  (function () {
    var leavePopupOverlay = document.getElementById("leavePopupOverlay");
    var leavePopupMsg = document.getElementById("leavePopupMsg");
    var leavePopupStay = document.getElementById("leavePopupStay");
    var leavePopupLeave = document.getElementById("leavePopupLeave");
    if (!leavePopupOverlay) return;

    function openLeavePopup() {
      var produto = pixProductName ? pixProductName.textContent : "este produto";
      var valor = pixAmount ? pixAmount.textContent : "o valor arrematado";
      leavePopupMsg.textContent = "Se você sair agora, vai perder a aprovação que conseguiu para comprar " + produto + " por " + valor + ".";
      leavePopupOverlay.classList.add("is-open");
    }
    function closeLeavePopup() { leavePopupOverlay.classList.remove("is-open"); }

    // Fase de captura no document: intercepta antes do listener do menu
    // (em main.js) rodar, pra nao abrir a navegacao de categorias junto.
    document.addEventListener("click", function (e) {
      if (!pixPending) return;
      var trigger = e.target.closest("#mobileMenuBtn, #headerLogoLink, #headerAccountLink, #headerFavLink, #headerCartLink");
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      openLeavePopup();
    }, true);

    if (leavePopupStay) leavePopupStay.addEventListener("click", closeLeavePopup);
    if (leavePopupLeave) leavePopupLeave.addEventListener("click", function () {
      window.location.href = "index.html";
    });
    leavePopupOverlay.addEventListener("click", function (e) {
      if (e.target === leavePopupOverlay) closeLeavePopup();
    });
  })();

  /* ---------- Popup de "codigo copiado" (fecha pelo X ou arrastando) ---------- */
  (function () {
    var overlay = document.getElementById("copyPopupOverlay");
    var closeX = document.getElementById("copyPopupCloseX");
    var track = document.getElementById("copySliderTrack");
    var slider = document.getElementById("copySliderBtn");
    if (!overlay || !slider) return;

    var DARK = [23, 164, 82];
    var LIGHT = [217, 242, 227];

    function closePopup() {
      overlay.classList.remove("is-open");
      resetSlider();
    }
    function resetSlider() {
      slider.classList.remove("is-dragging");
      slider.classList.add("is-snapping");
      slider.style.transform = "translateX(0)";
      slider.style.backgroundColor = "rgb(" + DARK.join(",") + ")";
      setTimeout(function () { slider.classList.remove("is-snapping"); }, 250);
    }

    if (closeX) closeX.addEventListener("click", closePopup);

    var dragging = false;
    var startX = 0;
    var maxDrag = 0;

    function onPointerDown(e) {
      dragging = true;
      startX = e.clientX;
      maxDrag = track.clientWidth - slider.clientWidth;
      slider.classList.add("is-dragging");
      slider.classList.remove("is-snapping");
      slider.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e) {
      if (!dragging) return;
      var delta = Math.min(0, Math.max(-maxDrag, e.clientX - startX));
      var progress = maxDrag > 0 ? Math.abs(delta) / maxDrag : 0;
      slider.style.transform = "translateX(" + delta + "px)";
      var mixed = DARK.map(function (c, i) { return Math.round(c + (LIGHT[i] - c) * progress); });
      slider.style.backgroundColor = "rgb(" + mixed.join(",") + ")";
      slider.dataset.progress = progress;
    }
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      var moved = Math.abs(e.clientX - startX);
      var progress = parseFloat(slider.dataset.progress || "0");
      if (moved < 6 || progress > 0.85) {
        closePopup();
      } else {
        resetSlider();
      }
    }

    slider.addEventListener("pointerdown", onPointerDown);
    slider.addEventListener("pointermove", onPointerMove);
    slider.addEventListener("pointerup", onPointerUp);
    slider.addEventListener("pointercancel", onPointerUp);
  })();
})();
