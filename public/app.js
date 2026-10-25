// SiroConsultas v2 · comportamiento mínimo del navegador, sin dependencias.
// La CSP no permite scripts en línea: todo lo interactivo se engancha desde acá con atributos data-*.
(() => {
  'use strict'

  // Ventanas: <button data-abre="id"> abre <dialog id="id">; [data-cierra] la cierra; tocar el velo también.
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null
    if (!t) return
    const abre = t.closest('[data-abre]')
    if (abre) {
      const d = document.getElementById(abre.getAttribute('data-abre'))
      if (d && typeof d.showModal === 'function') { e.preventDefault(); d.showModal(); return }
    }
    const cierra = t.closest('[data-cierra]')
    if (cierra) {
      const d = cierra.closest('dialog')
      if (d) { e.preventDefault(); d.close(); return }
    }
    if (t instanceof HTMLDialogElement && t.open) {
      const r = t.getBoundingClientRect()
      const fuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
      if (fuera) t.close()
    }
  })

  // Formularios: piden confirmación si lo dicen y no se mandan dos veces (el doble clic no duplica).
  document.addEventListener('submit', (e) => {
    const f = e.target
    if (!(f instanceof HTMLFormElement)) return
    const pregunta = f.getAttribute('data-confirmar')
    if (pregunta && !window.confirm(pregunta)) { e.preventDefault(); return }
    if (f.dataset.enviando === '1') { e.preventDefault(); return }
    f.dataset.enviando = '1'
    for (const b of f.querySelectorAll('button[type="submit"], button:not([type])')) b.setAttribute('aria-disabled', 'true')
  })

  // Pastillas que se marcan (filtros de muestra): aria-pressed alterna.
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest('[data-alterna]') : null
    if (!t) return
    const grupo = t.parentElement
    if (grupo) for (const b of grupo.querySelectorAll('[data-alterna]')) b.setAttribute('aria-pressed', String(b === t))
  })

  // Agenda: las ventanas llegan abiertas desde el servidor; se vuelven modales y, al cerrarlas, se vuelve a la agenda de abajo.
  for (const d of document.querySelectorAll('dialog[data-volver]')) {
    if (typeof d.showModal === 'function') { d.removeAttribute('open'); d.showModal() }
    d.addEventListener('close', () => { window.location.href = d.dataset.volver })
  }

  // Bloquear la agenda: al cambiar un dato se vuelve a armar la pantalla con lo elegido (el aviso de cuántos turnos caen adentro).
  for (const f of document.querySelectorAll('form[data-recalcular]')) {
    for (const b of f.querySelectorAll('[data-sin-js]')) b.hidden = true
    f.addEventListener('change', () => {
      const p = new URLSearchParams()
      for (const [k, v] of new FormData(f)) if (typeof v === 'string' && v) p.set(k, v)
      window.location.assign(`${f.dataset.recalcular}?${p}`)
    })
  }

  for (const aviso of document.querySelectorAll('[data-config-abrir]')) {
    const ventana = document.getElementById(aviso.dataset.configAbrir)
    if (ventana instanceof HTMLDialogElement) ventana.showModal()
  }

  const actualizarModalidad = (consultorio) => {
    const presencial = consultorio.querySelector('input[type="radio"]:checked')?.value === 'presencial'
    for (const campo of consultorio.querySelectorAll('[data-config-presencial]')) {
      campo.hidden = !presencial
      for (const input of campo.querySelectorAll('input')) {
        input.disabled = !presencial
        input.required = presencial && input.name.endsWith('_direccion')
      }
    }
  }
  for (const consultorio of document.querySelectorAll('[data-config-consultorio]')) actualizarModalidad(consultorio)
  document.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'radio') return
    const consultorio = e.target.closest('[data-config-consultorio]')
    if (consultorio) actualizarModalidad(consultorio)
  })

  // Configuración: franjas por día, sin scripts en línea ni dependencias.
  const actualizarDia = (dia) => {
    const activo = dia.querySelector('input[type="checkbox"]').checked
    dia.toggleAttribute('data-config-apagado', !activo)
    for (const input of dia.querySelectorAll('input[type="time"]')) input.disabled = !activo
  }
  for (const dia of document.querySelectorAll('[data-config-dia]')) actualizarDia(dia)
  document.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'checkbox') return
    const dia = e.target.closest('[data-config-dia]')
    if (dia) actualizarDia(dia)
  })
  document.addEventListener('click', (e) => {
    const boton = e.target instanceof Element ? e.target.closest('[data-config-otro], [data-config-quitar]') : null
    if (!boton) return
    const dia = boton.closest('[data-config-dia]')
    const franjas = dia.querySelector('[data-config-franjas]')
    if (boton.hasAttribute('data-config-otro')) {
      if (franjas.children.length >= 12) return
      const copia = franjas.firstElementChild.cloneNode(true)
      for (const input of copia.querySelectorAll('input')) input.value = ''
      // Las etiquetas contienen los controles; se renumera su texto accesible.
      for (const texto of copia.querySelectorAll('.oculto-visual')) texto.textContent = texto.textContent.replace(/franja \d+/, `franja ${franjas.children.length + 1}`)
      franjas.append(copia)
      copia.querySelector('input').focus()
    } else {
      const fila = boton.closest('.config-franja')
      if (franjas.children.length > 1) fila.remove()
      else for (const input of fila.querySelectorAll('input')) input.value = ''
    }
  })


  // ---------- consultas ----------
  // Cola única de autoguardado. Nunca se guarda texto clínico en localStorage.
  const editor = document.querySelector('[data-consulta-editor]')
  if (editor) {
    const formulario = editor.querySelector('[data-consulta-formulario]')
    const estado = editor.querySelector('[data-consulta-estado]')
    const aviso = editor.querySelector('[data-consulta-error]')
    let pendiente = false, guardando = null, temporizador, conflicto = false
    const informarError = (mensaje) => {
      aviso.textContent = mensaje
      aviso.hidden = false
      const enlace = document.createElement('a')
      enlace.href = editor.dataset.consultaHistoria
      enlace.target = '_blank'; enlace.rel = 'noopener'
      enlace.textContent = ' Abrir la historia guardada en otra pestaña'
      aviso.append(enlace)
    }
    const guardar = (forzar = false) => {
      if (conflicto) return Promise.resolve(false)
      if (forzar) pendiente = true
      clearTimeout(temporizador)
      if (guardando) return guardando
      if (!pendiente) return Promise.resolve(true)
      guardando = (async () => {
        while (pendiente) {
          pendiente = false
          estado.textContent = 'Guardando borrador…'
          try {
            const respuesta = await fetch(formulario.action, { method: 'POST', body: new FormData(formulario), headers: { Accept: 'application/json' } })
            let datos
            try { datos = await respuesta.json() } catch { throw new Error('El servidor no pudo guardar el borrador. Probá de nuevo.') }
            if (!respuesta.ok) {
              conflicto = respuesta.status === 409
              throw new Error(datos.error || 'No se pudo guardar el borrador.')
            }
            for (const version of editor.querySelectorAll('[data-consulta-version]')) version.value = String(datos.version)
            history.replaceState(null, '', datos.url)
            estado.textContent = `Borrador guardado · versión ${datos.version}`
            aviso.hidden = true
          } catch (error) {
            pendiente = true
            estado.textContent = 'Cambios sin guardar'
            informarError(`${error instanceof TypeError ? 'No se pudo conectar para guardar. Probá de nuevo.' : error instanceof Error ? error.message : 'No se pudo guardar.'} El texto sigue en esta pantalla.`)
            return false
          }
        }
        return true
      })().finally(() => { guardando = null })
      return guardando
    }
    const cambio = () => {
      pendiente = true
      estado.textContent = conflicto ? 'Conflicto: cambios sin guardar' : 'Cambios sin guardar'
      clearTimeout(temporizador)
      if (!conflicto) temporizador = setTimeout(() => guardar(), 800)
    }
    formulario.addEventListener('input', cambio)
    formulario.addEventListener('change', cambio)
    formulario.addEventListener('submit', async (evento) => {
      if (evento.defaultPrevented) return
      evento.preventDefault()
      await guardar(true)
      formulario.dataset.enviando = '0'
      for (const b of formulario.querySelectorAll('[aria-disabled]')) b.removeAttribute('aria-disabled')
    })
    editor.addEventListener('click', async (evento) => {
      const boton = evento.target instanceof Element ? evento.target.closest('button, a') : null
      if (!boton) return
      if (boton.hasAttribute('data-consulta-ninguno')) {
        formulario.elements.namedItem(boton.dataset.consultaNinguno).value = 'Ninguno'
        cambio()
      }
      if (boton.hasAttribute('data-consulta-copiar')) {
        formulario.elements.namedItem('plan').value = editor.querySelector('[data-consulta-plan-anterior]').value
        cambio()
      }
      if (boton.hasAttribute('data-consulta-control')) {
        formulario.elements.namedItem('proximo_control').value = boton.dataset.consultaControl
        cambio()
      }
      if (boton.hasAttribute('data-consulta-terminar')) {
        if (await guardar(Number(formulario.elements.namedItem('version').value) === 0)) editor.querySelector('#consulta-terminar').showModal()
      }
      if (boton.hasAttribute('data-consulta-salir')) {
        evento.preventDefault()
        if (await guardar()) location.assign(boton.href)
      }
    })
    for (const form of editor.querySelectorAll('[data-consulta-mutacion]')) form.addEventListener('submit', async (evento) => {
      if (evento.defaultPrevented) return
      evento.preventDefault()
      if (await guardar(Number(formulario.elements.namedItem('version').value) === 0)) {
        if (form.hasAttribute('data-documento-form')) form.dispatchEvent(new Event('documento-enviar'))
        else HTMLFormElement.prototype.submit.call(form)
      }
      else {
        form.dataset.enviando = '0'
        for (const b of form.querySelectorAll('[aria-disabled]')) b.removeAttribute('aria-disabled')
        form.closest('dialog')?.close()
      }
    })
    window.addEventListener('beforeunload', (evento) => {
      if (pendiente || guardando) { evento.preventDefault(); evento.returnValue = '' }
    })
  }

  // ---------- documentos ----------
  for (const form of document.querySelectorAll('[data-documento-form]')) {
    let enviando = false
    async function emitir() {
      if (enviando) return
      enviando = true
      const error = form.querySelector('[data-documento-error]')
      error.hidden = true
      try {
        const r = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
        const datos = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(datos.error || 'No se pudo guardar el documento. Probá de nuevo.')
        const resultado = form.parentElement.querySelector('[data-documento-resultado]')
        resultado.querySelector('h3').textContent = `${datos.titulo} guardado en la ficha`
        resultado.querySelector('[data-documento-ver]').href = datos.url
        const archivo = resultado.querySelector('[data-documento-pdf]')
        archivo.textContent = datos.titulo === 'Estudio' ? 'Descargar estudio' : 'Descargar PDF'
        archivo.hidden = !datos.pdf
        if (datos.pdf) archivo.href = datos.pdf
        resultado.querySelector('[data-documento-wa]').href = datos.whatsapp
        const correo = resultado.querySelector('[data-documento-correo]')
        correo.hidden = !datos.correo
        if (datos.correo) correo.href = datos.correo
        // MisRx envía su propia receta; acá solo se confirma el registro clínico.
        for (const e of resultado.querySelectorAll('h3:not(:first-child), p, [data-documento-wa], [data-documento-correo]')) {
          if (!datos.pdf) e.hidden = true
        }
        form.hidden = true
        resultado.hidden = false
        const hechos = document.querySelector('[data-documentos-hechos]')
        if (hechos) {
          const enlace = document.createElement('a')
          enlace.dataset.modulo = 'documentos'
          enlace.href = datos.url
          enlace.textContent = `${datos.titulo} guardado · ver`
          enlace.target = '_blank'
          enlace.rel = 'noopener'
          hechos.append(enlace)
        }
      } catch (e) { error.textContent = e.message; error.hidden = false }
      finally {
        enviando = false
        delete form.dataset.enviando
        for (const boton of form.querySelectorAll('[type=submit]')) { boton.removeAttribute('aria-disabled'); boton.disabled = false }
      }
    }
    form.addEventListener('documento-enviar', emitir)
    if (!form.hasAttribute('data-consulta-mutacion')) form.addEventListener('submit', evento => {
      if (evento.defaultPrevented) return
      evento.preventDefault()
      emitir()
    })
  }
  // ---------- comprobantes ----------
  for (const form of document.querySelectorAll('[data-comp-emitir]')) {
    const otra = form.querySelector('[data-comp-otra]')
    const actualizar = () => {
      const mostrar = form.querySelector('[name=receptor]:checked')?.value === 'otra'
      otra.hidden = !mostrar
      for (const campo of otra.querySelectorAll('input,select')) { campo.disabled = !mostrar; campo.required = mostrar }
    }
    form.addEventListener('change', actualizar)
    actualizar()
  }
  for (const form of document.querySelectorAll('[data-comp-config]')) {
    const previa = form.querySelector('[data-comp-previa]'), logo = previa.querySelector('[data-comp-logo]')
    const logoOriginal = logo.getAttribute('src')
    const actualizar = () => {
      const color = form.querySelector('[name=comprobante_color]:checked')?.dataset.compColor || 'teal'
      for (const nombre of ['holly','teal','azul','violeta']) previa.classList.toggle(`comp-${nombre}`, nombre === color)
      previa.querySelector('[data-comp-pie]').textContent = form.elements.namedItem('comprobante_pie').value
      if (form.elements.namedItem('quitar_logo')?.checked) logo.hidden = true
    }
    form.addEventListener('input', actualizar)
    const entrada = form.querySelector('[data-comp-logo-input]')
    entrada.addEventListener('change', () => {
      const archivo = entrada.files[0]
      if (form.elements.namedItem('quitar_logo')) form.elements.namedItem('quitar_logo').checked = false
      if (!archivo) { if (logoOriginal) logo.src = logoOriginal; logo.hidden = !logoOriginal; return }
      if (archivo.size > 2*1024*1024 || !['image/jpeg','image/png'].includes(archivo.type)) return
      const lector = new FileReader()
      lector.addEventListener('load', () => { if (entrada.files[0] === archivo) { logo.src = lector.result; logo.hidden = false } })
      lector.readAsDataURL(archivo)
    })
    form.elements.namedItem('quitar_logo')?.addEventListener('change', () => { logo.hidden = form.elements.namedItem('quitar_logo').checked || !logo.getAttribute('src') })
  }
  // ---------- recordatorio por WhatsApp: se abre el enlace y se deja anotado ----------
  for (const enlace of document.querySelectorAll('a[data-anotar]')) {
    enlace.addEventListener('click', () => {
      fetch(enlace.dataset.anotar, { method: 'POST', body: new FormData(), keepalive: true }).catch(() => {})
    })
  }
  // ---------- recordatorios: vista previa mientras se escribe ----------
  for (const texto of document.querySelectorAll('textarea[data-recordatorio]')) {
    const previa = document.getElementById(texto.dataset.recordatorio)
    if (!previa) continue
    texto.addEventListener('input', () => {
      previa.textContent = texto.value.replace(/\{(nombre|dia|hora|lugar)\}/g, (_, k) => previa.dataset[k] ?? '')
    })
  }
})()
