document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('hamburger');
  const nav = document.getElementById('primary-nav');
  if (!button || !nav) return;

  const toggle = () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    nav.classList.toggle('open', !open);
  };

  const close = () => {
    button.setAttribute('aria-expanded', 'false');
    nav.classList.remove('open');
  };

  button.addEventListener('click', toggle);
  window.addEventListener('scroll', close, { passive: true });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
});
