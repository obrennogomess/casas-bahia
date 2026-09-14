let currentTransactionId = null
let paymentCheckInterval = null
const valorPix = 27.90

function collectUTMParameters() {
  const currentUrl = new URL(window.location.href)

  return {
    utm_source: currentUrl.searchParams.get('utm_source') || '',
    utm_campaign: currentUrl.searchParams.get('utm_campaign') || '',
    utm_medium: currentUrl.searchParams.get('utm_medium') || '',
    utm_content: currentUrl.searchParams.get('utm_content') || '',
    utm_term: currentUrl.searchParams.get('utm_term') || '',
    fbclid: currentUrl.searchParams.get('fbclid') || ''
  }
}

// Recupera o comprador salvo no checkout principal (js/checkout.js) para
// reutilizar o mesmo CPF/dados ao gerar a cobrança do upsell na Mangofy.
function getStoredBuyer() {
  try {
    return JSON.parse(localStorage.getItem('arremata_buyer') || '{}') || {}
  } catch (e) {
    return {}
  }
}

function upsellOrderId() {
  return 'up2-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

async function gerarPixAPI() {
  const buyer = getStoredBuyer()
  const utm = collectUTMParameters()

  const response = await fetch('/api/pix/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      orderId: upsellOrderId(),
      slug: 'upsell-up2',
      title: 'Taxa de frete do pedido',
      price: valorPix,
      name: buyer.name,
      email: buyer.email,
      cpf: buyer.cpf,
      phone: buyer.phone,
      source: utm.utm_source,
      medium: utm.utm_medium,
      campaign: utm.utm_campaign
    })
  })

  if (!response.ok) {
    const err = await response.json().catch(() => null)
    throw new Error((err && err.error) ? err.error : `Erro HTTP: ${response.status}`)
  }

  const result = await response.json()

  const pixCode = result.payload || ''
  const txId = result.id || ''
  const qrCode = result.qrDataUrl || ''

  if (!pixCode || !txId) {
    console.log('Resposta da API:', result)
    throw new Error('Resposta inválida da API')
  }

  return {
    pixCode,
    txId,
    qrCode
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function preencherPixNaTela(data) {
  const pixCodeEl = document.getElementById('pixCode')
  const qrBox = document.getElementById('qrCanvas')

  if (pixCodeEl) {
    pixCodeEl.textContent = data.pixCode || ''
  }

  if (qrBox) {
    qrBox.innerHTML = ''
  }

  if (data.qrCode && String(data.qrCode).trim() !== '') {
    renderQrImage(data.qrCode)
    return
  }

  if (data.pixCode) {
    renderQrCodeReal(data.pixCode)
  }
}

function normalizarQrCodeSrc(src) {
  if (!src) return ''
  if (src.startsWith('data:image')) return src
  if (src.startsWith('http://') || src.startsWith('https://')) return src
  return `data:image/png;base64,${src}`
}

function renderQrCodeReal(pixCode) {
  const qrBox = document.getElementById('qrCanvas')
  if (!qrBox || !pixCode) return

  qrBox.innerHTML = ''

  try {
    new QRCode(qrBox, {
      text: pixCode,
      width: 150,
      height: 150,
      correctLevel: QRCode.CorrectLevel.L
    })
  } catch (error) {
    console.error('Erro ao renderizar QR pelo pixCode:', error)
  }
}
function renderQrImage(src) {
  const qrBox = document.getElementById('qrCanvas')
  if (!qrBox || !src) return

  qrBox.innerHTML = ''

  const img = document.createElement('img')
  img.alt = 'QR Code PIX'
  img.style.width = '150px'
  img.style.height = '150px'
  img.style.display = 'block'

  img.onload = function () {}

  img.onerror = function () {
    const pixCode = document.getElementById('pixCode')?.textContent?.trim() || ''
    renderQrCodeReal(pixCode)
  }

  img.src = normalizarQrCodeSrc(src)
  qrBox.appendChild(img)
}

function copiarPix() {
  const code = document.getElementById('pixCode')?.innerText.trim() || ''
  const btn = document.getElementById('btnCopiar')
  const txt = document.getElementById('btnText')

  if (!code) return

  const done = () => {
    if (btn) btn.classList.add('copied')
    if (txt) txt.textContent = 'COPIADO!'
    setTimeout(() => {
      if (btn) btn.classList.remove('copied')
      if (txt) txt.textContent = 'COPIAR'
    }, 3000)
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(done).catch(() => {
      const textarea = document.createElement('textarea')
      textarea.value = code
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      done()
    })
  } else {
    const textarea = document.createElement('textarea')
    textarea.value = code
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    done()
  }
}

function startTimer() {
  let total = 29 * 60 + 59
  const el = document.getElementById('timerDisplay')
  if (!el) return

  const iv = setInterval(() => {
    if (total <= 0) {
      clearInterval(iv)
      el.textContent = '00:00'
      return
    }

    total--
    el.textContent =
      String(Math.floor(total / 60)).padStart(2, '0') +
      ':' +
      String(total % 60).padStart(2, '0')
  }, 1000)
}

async function verificarPagamento() {
  if (!currentTransactionId) {
    currentTransactionId = localStorage.getItem('currentTransactionId')
  }

  if (!currentTransactionId) {
    return false
  }

  try {
    const response = await fetch(`/api/pix/status/${encodeURIComponent(currentTransactionId)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    if (response.status !== 200) {
      return false
    }

    const result = await response.json()
    const isPaid = result.status === 'AUTHORIZED'

    if (isPaid) {
      const statusEl = document.getElementById('pixStatus')
      if (statusEl) {
        statusEl.innerHTML = 'Pagamento confirmado! Redirecionando...'
      }

      setTimeout(() => {
        window.location.href = '../up3/index.html' + window.location.search
      }, 2000)

      return true
    } else {
      const statusEl = document.getElementById('pixStatus')
      if (statusEl) {
        statusEl.innerHTML = 'Aguardando pagamento...'
      }
      return false
    }
  } catch (error) {
    console.error('Erro ao verificar pagamento:', error)
    return false
  }
}

function iniciarVerificacaoAutomatica() {
  if (paymentCheckInterval) {
    clearInterval(paymentCheckInterval)
  }

  paymentCheckInterval = setInterval(async () => {
    const aprovado = await verificarPagamento()
    if (aprovado) {
      clearInterval(paymentCheckInterval)
    }
  }, 5000)
}

document.querySelector('.btn-confirmar').addEventListener('click', function () {
  const overlay = document.getElementById('overlay')
  const fill = document.getElementById('progressFill')
  const label = document.getElementById('progressLabel')

  overlay.classList.add('active')

  const steps = [15, 35, 58, 74, 89, 100]
  const delays = [300, 600, 900, 1300, 1700, 2200]

  steps.forEach((val, i) => {
    setTimeout(() => {
      fill.style.width = val + '%'
      label.textContent = val + '%'
    }, delays[i])
  })

  setTimeout(() => {
    overlay.classList.remove('active')
    document.getElementById('page1wrap').style.display = 'none'
    const err = document.getElementById('errorScreen')
    err.style.display = 'block'
    err.style.animation = 'slide-up 0.35s cubic-bezier(.22,.68,0,1.2) both'
  }, 2800)
})

document.querySelector('.btn-frete').addEventListener('click', async function () {
  const gerando = document.getElementById('genOverlay')
  gerando.style.display = 'flex'

  const gsIds = ['gs1', 'gs2', 'gs3', 'gs4']
  const gsDelays = [600, 1200, 1900, 2600]

  gsIds.forEach((id, i) => {
    const el = document.getElementById(id)
    if (el) el.className = 'gen-step'
  })

  const tempoMinimoOverlay = wait(3500)
  const pixPromise = gerarPixAPI()

  gsIds.forEach((id, i) => {
    setTimeout(() => {
      if (i > 0) document.getElementById(gsIds[i - 1]).className = 'gen-step done'
      document.getElementById(id).className = 'gen-step active'
    }, gsDelays[i])
  })

  setTimeout(() => {
    document.getElementById('gs4').className = 'gen-step done'
  }, 3200)

  try {
    const [pixData] = await Promise.all([pixPromise, tempoMinimoOverlay])

    if (!pixData.pixCode || !pixData.txId) {
      throw new Error('Resposta inválida da API')
    }

    currentTransactionId = pixData.txId
    localStorage.setItem('currentTransactionId', currentTransactionId)

    preencherPixNaTela(pixData)

    document.getElementById('genOverlay').style.display = 'none'
    document.getElementById('errorScreen').style.display = 'none'
    document.getElementById('pixPage').style.display = 'flex'

    startTimer()
    iniciarVerificacaoAutomatica()
  } catch (error) {
    console.error('Erro ao gerar PIX:', error)
    document.getElementById('genOverlay').style.display = 'none'
    document.getElementById('errorScreen').style.display = 'block'
    alert('Erro ao gerar PIX: ' + error.message)
  }
})