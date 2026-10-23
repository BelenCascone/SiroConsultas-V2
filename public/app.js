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

})()
