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
      if (await guardar(Number(formulario.elements.namedItem('version').value) === 0)) HTMLFormElement.prototype.submit.call(form)
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

})()
