(function () {
  "use strict";

  function parseBRNumber(str) {
    var clean = String(str).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
    return parseFloat(clean);
  }
  function formatBRL(value) {
    return "R$ " + value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function track(event, slug, amount) {
    var payload = { event: event, slug: slug };
    if (typeof amount === "number") payload.amount = amount;
    if (window.getAttribution) {
      var attr = window.getAttribution();
      payload.source = attr.source;
      payload.medium = attr.medium;
      payload.campaign = attr.campaign;
    }
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {});
  }

  /* ---------- Gallery thumbnails ---------- */
  var pdpThumbs = document.getElementById("pdpThumbs");
  var pdpMainImage = document.getElementById("pdpMainImage");
  if (pdpThumbs && pdpMainImage) {
    pdpThumbs.addEventListener("click", function (e) {
      var thumb = e.target.closest(".pdp__thumb");
      if (!thumb) return;
      pdpMainImage.src = thumb.getAttribute("data-src");
      pdpThumbs.querySelectorAll(".pdp__thumb").forEach(function (t) { t.classList.toggle("is-active", t === thumb); });
    });
  }

  /* ---------- Tabs ---------- */
  var tabsNav = document.getElementById("pdpTabsNav");
  if (tabsNav) {
    var tabButtons = tabsNav.querySelectorAll(".pdp-tabs__btn");
    var panels = document.querySelectorAll(".pdp-tabs__panel");
    tabsNav.addEventListener("click", function (e) {
      var btn = e.target.closest(".pdp-tabs__btn");
      if (!btn) return;
      tabButtons.forEach(function (b) { b.classList.toggle("is-active", b === btn); });
      panels.forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== btn.getAttribute("data-tab"); });
    });
  }

  /* ---------- Bid form ---------- */
  var bidForm = document.getElementById("bidForm");
  var bidInput = document.getElementById("bidInput");
  var bidButtonAmount = document.getElementById("bidButtonAmount");
  var bidFeedback = document.getElementById("bidFeedback");
  var currentBidPrice = document.getElementById("currentBidPrice");
  var minNextBidEl = document.getElementById("minNextBid");
  var bidCountEl = document.getElementById("bidCount");
  var bidHistoryBody = document.getElementById("bidHistoryBody");

  var bidModalOverlay = document.getElementById("bidModalOverlay");
  var bidStageAnalyzing = document.getElementById("bidStageAnalyzing");
  var bidStageApproved = document.getElementById("bidStageApproved");
  var bidModalAmount = document.getElementById("bidModalAmount");
  var bidModalFinalAmount = document.getElementById("bidModalFinalAmount");
  var bidModalProduct = document.getElementById("bidModalProduct");
  var bidModalContinue = document.getElementById("bidModalContinue");

  var BID_INCREMENT = 20;
  var fakeBidders = ["Você", "M**** A.", "J*** P.", "R******. F.", "L**** T.", "A***. G."];

  if (bidForm) {
    var currentBid = parseBRNumber(currentBidPrice.textContent);
    var minNextBid = parseBRNumber(minNextBidEl.textContent);
    var bidCount = parseInt(bidCountEl.textContent, 10);

    var productTitle = document.querySelector(".pdp-title-row h1");
    productTitle = productTitle ? productTitle.textContent.trim() : "Produto";
    var slugMatch = window.location.pathname.match(/product-([a-z0-9-]+)\.html/);
    var productSlug = slugMatch ? slugMatch[1] : "";
    var mainImageEl = document.getElementById("pdpMainImage");
    var productImage = mainImageEl ? mainImageEl.getAttribute("src") : "img/products/" + productSlug + "/1.jpg";

    if (productSlug) track("product_view", productSlug);

    function confirmBid(value) {
      currentBid = value;
      bidCount += 1;
      minNextBid = currentBid + BID_INCREMENT;
      track("bid_placed", productSlug, value);

      currentBidPrice.textContent = formatBRL(currentBid);
      minNextBidEl.textContent = formatBRL(minNextBid);
      bidCountEl.textContent = bidCount;
      bidInput.value = minNextBid.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      bidButtonAmount.textContent = formatBRL(minNextBid);

      bidFeedback.textContent = "Você deu o lance mais alto! Fique de olho no cronômetro.";
      bidFeedback.className = "pdp__bid-feedback is-success";

      if (bidHistoryBody) {
        var row = document.createElement("tr");
        var name = fakeBidders[Math.floor(Math.random() * fakeBidders.length)];
        row.innerHTML = "<td>" + name + "</td><td>" + formatBRL(currentBid) + "</td><td>agora</td>";
        bidHistoryBody.insertBefore(row, bidHistoryBody.firstChild);
        Array.prototype.forEach.call(bidHistoryBody.querySelectorAll("tr"), function (tr, i) {
          tr.style.fontWeight = i === 0 ? "700" : "";
        });
      }
    }

    bidForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = minNextBid;

      if (!bidModalOverlay) {
        confirmBid(value);
        return;
      }

      bidStageAnalyzing.hidden = false;
      bidStageApproved.hidden = true;
      bidModalAmount.textContent = formatBRL(value);
      bidModalOverlay.classList.add("is-open");

      setTimeout(function () {
        confirmBid(value);

        bidModalProduct.textContent = productTitle;
        bidModalFinalAmount.textContent = formatBRL(value);
        bidStageAnalyzing.hidden = true;
        bidStageApproved.hidden = false;

        addWonItemToCart(value);
      }, 2000);
    });

    // Adiciona o produto arrematado ao carrinho e ajusta o modal com os dois
    // caminhos: "Finalizar e pagar" ou "Escolher mais produtos".
    function addWonItemToCart(value) {
      var result = "added";
      if (window.Cart) {
        result = window.Cart.add({
          slug: productSlug,
          title: productTitle,
          price: value,
          img: productImage,
          back: !!window.__backofferActive
        });
      }

      var count = window.Cart ? window.Cart.count() : 1;

      var notice = bidStageApproved.querySelector(".bid-modal__notice p");
      if (notice) {
        if (result === "exists") {
          notice.textContent = "Este produto já estava nos seus lances. Você pode escolher quantos produtos quiser.";
        } else {
          notice.textContent = "Escolha mais produtos ou finalize agora. Sem limite de itens por CPF.";
        }
      }

      if (bidModalContinue) {
        bidModalContinue.textContent = count > 1 ? "Finalizar e pagar (" + count + " itens)" : "Finalizar e pagar";
      }

      if (bidModalContinue && !document.getElementById("bidModalMore")) {
        var more = document.createElement("button");
        more.type = "button";
        more.id = "bidModalMore";
        more.className = "bid-modal__cta bid-modal__cta--ghost";
        more.addEventListener("click", function () {
          // Volta pra loja para escolher outro produto (o carrinho fica salvo).
          window.location.href = getUrlWithUtm("index.html");
        });
        bidModalContinue.parentNode.insertBefore(more, bidModalContinue.nextSibling);
      }
      var moreBtn = document.getElementById("bidModalMore");
      if (moreBtn) {
        moreBtn.textContent = "Escolher mais produtos";
        moreBtn.style.display = "";
      }
    }

    if (bidModalContinue) {
      bidModalContinue.addEventListener("click", function () {
        // Se um link externo estiver configurado neste produto, vai direto
        // pra ele. Vazio (padrao) mantem o checkout com a API Pix atual.
        var externalLink = bidModalContinue.getAttribute("data-checkout-link");
        if (externalLink) {
          window.location.href = getUrlWithUtm(externalLink);
          return;
        }

        // Modo carrinho: o checkout lê os itens do carrinho (vários produtos).
        if (window.Cart && window.Cart.count() > 0) {
          window.location.href = getUrlWithUtm("checkout.html");
          return;
        }

        // Fallback (sem carrinho): fluxo antigo de item único via parâmetros.
        var params = new URLSearchParams({
          slug: productSlug,
          title: productTitle,
          price: currentBid.toFixed(2),
          img: productImage
        });
        window.location.href = getUrlWithUtm("checkout.html?" + params.toString());
      });
    }
  }

  /* ---------- Frete lookup (ViaCEP) ---------- */
  var freteInput = document.getElementById("freteInput");
  var freteConsultar = document.getElementById("freteConsultar");
  var freteResult = document.getElementById("freteResult");

  if (freteInput) {
    freteInput.addEventListener("input", function () {
      var digits = freteInput.value.replace(/\D/g, "").slice(0, 8);
      freteInput.value = digits.length > 5 ? digits.slice(0, 5) + "-" + digits.slice(5) : digits;
      freteResult.textContent = "";
      freteResult.className = "pdp__frete-result";
    });
  }

  if (freteConsultar) {
    freteConsultar.addEventListener("click", function () {
      var digits = freteInput.value.replace(/\D/g, "");
      if (digits.length !== 8) {
        freteResult.textContent = "Digite um CEP válido com 8 números.";
        freteResult.className = "pdp__frete-result is-error";
        return;
      }
      freteConsultar.disabled = true;
      freteResult.textContent = "Calculando...";
      freteResult.className = "pdp__frete-result";

      fetch("https://viacep.com.br/ws/" + digits + "/json/")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.erro) {
            freteResult.textContent = "CEP não encontrado. Verifique e tente novamente.";
            freteResult.className = "pdp__frete-result is-error";
            return;
          }
          var city = [data.localidade, data.uf].filter(Boolean).join(" - ");
          var days = 4 + Math.floor(Math.random() * 5);
          freteResult.textContent = "Entrega para " + city + " em até " + days + " dias úteis após o fim do leilão.";
          freteResult.className = "pdp__frete-result is-success";
        })
        .catch(function () {
          freteResult.textContent = "Não foi possível calcular agora. Tente novamente.";
          freteResult.className = "pdp__frete-result is-error";
        })
        .then(function () {
          freteConsultar.disabled = false;
        });
    });
  }
})();
