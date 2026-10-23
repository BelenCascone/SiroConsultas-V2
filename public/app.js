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
})()
