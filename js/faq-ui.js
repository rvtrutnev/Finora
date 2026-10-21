(function (root) {
  'use strict';
  function create({document, content}) {
    const el = (tag, text, id) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (id) node.id = id;
      return node;
    };
    const dialog = el('dialog', '', 'faq-dialog');
    dialog.className = 'faq-panel';
    dialog.setAttribute('aria-labelledby', 'faq-title');
    dialog.setAttribute('lang', 'ru');
    const header = el('header');header.className = 'faq-header';
    const title = el('h2', 'Справка Finora', 'faq-title');
    const closeButton = el('button', 'Закрыть', 'faq-close');closeButton.type = 'button';
    header.append(title, closeButton);
    const navigation = el('div');navigation.className = 'faq-navigation';
    const label = el('label', 'Раздел справки');label.setAttribute('for', 'faq-section');
    const select = el('select', '', 'faq-section');
    for (const section of content.sections) {
      const option = el('option', section.title);option.value = section.id;select.append(option);
    }
    navigation.append(label,select);
    const article = el('article', '', 'faq-article');article.tabIndex = 0;
    article.setAttribute('aria-labelledby','faq-section-title');
    dialog.append(header,navigation,article);document.body.append(dialog);
    let returnFocus = null, previousOverflow = '', active = false;
    function render(id) {
      const section = content.getSection(id);select.value = section.id;
      const heading = el('h3',section.title,'faq-section-title');
      const steps = el('ol');
      for (const text of section.steps) steps.append(el('li',text));
      const notes = el('ul');
      for (const text of section.notes) notes.append(el('li',text));
      article.replaceChildren(heading,el('p',section.purpose),el('h4','Как пользоваться'),steps,
        el('h4','Пример'),el('p',section.example),el('h4','Что важно знать'),notes);
      article.scrollTop = 0;
    }
    function restore() {
      if (!active) return;
      active = false;
      document.body.style.overflow = previousOverflow;
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
    }
    function close() { if (dialog.open) dialog.close(); restore(); }
    function open(id) {
      render(id);
      if (dialog.open) return;
      returnFocus = document.activeElement;previousOverflow = document.body.style.overflow;
      dialog.showModal();active = true;document.body.style.overflow = 'hidden';closeButton.focus();
    }
    closeButton.addEventListener('click',close);
    select.addEventListener('change',() => render(select.value));
    dialog.addEventListener('cancel',event => { event.preventDefault(); close(); });
    dialog.addEventListener('close',() => { if (!dialog.open) restore(); });
    dialog.addEventListener('click',event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
    return {open,close};
  }
  const api = {create};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoraFAQ = api;
})(typeof window === 'object' ? window : globalThis);
