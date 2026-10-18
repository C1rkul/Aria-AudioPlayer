// Svelte action: полоса прокрутки почти невидимая, появляется при прокрутке/наведении и плавно исчезает
export function autohideScroll(node, delay = 1100) {
  let timer;
  const show = () => {
    node.classList.add('scroll-active');
    clearTimeout(timer);
    timer = setTimeout(() => node.classList.remove('scroll-active'), delay);
  };
  node.classList.add('autohide-scroll');
  node.addEventListener('scroll', show, { passive: true });
  node.addEventListener('wheel', show, { passive: true });
  return {
    destroy() {
      clearTimeout(timer);
      node.removeEventListener('scroll', show);
      node.removeEventListener('wheel', show);
    }
  };
}
