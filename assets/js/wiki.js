const root = document.documentElement;
const ui = JSON.parse(document.querySelector('#wiki-ui')?.textContent || '{}');
const languageSelect = document.querySelector('#language-select');
languageSelect?.addEventListener('change', () => {
  const option = languageSelect.selectedOptions[0];
  try { localStorage.setItem('wiki-language', option.dataset.language); } catch (_) {}
  location.assign(option.value + location.search + location.hash);
});
document.querySelector('.english-original')?.addEventListener('click', () => {
  try { localStorage.setItem('wiki-language', 'en'); } catch (_) {}
});
// Respect a saved preference on the English landing page; deep links keep their explicit locale.
if (languageSelect && root.lang === 'en' && document.body.dataset.sourceUrl === '/') {
  try {
    const saved = localStorage.getItem('wiki-language');
    const option = [...languageSelect.options].find(option => option.dataset.language === saved);
    if (option && saved !== 'en') location.replace(option.value + location.search + location.hash);
  } catch (_) {}
}
const toggle = document.querySelector('#theme-toggle');
function updateToggle() {
  const dark = root.dataset.theme === 'dark';
  toggle.textContent = dark ? ui.light_mode : ui.dark_mode;
  toggle.setAttribute('aria-label', dark ? ui.switch_light : ui.switch_dark);
}
toggle.hidden = false;
updateToggle();
toggle.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('wiki-theme', root.dataset.theme); } catch (_) {}
  updateToggle();
});
const heading = document.querySelector('.document h1');
if (heading) document.title = `${heading.textContent} · StarHermit`;
document.querySelectorAll('.sidebar a').forEach(link => {
  if (link.pathname === location.pathname && !link.hash) link.setAttribute('aria-current', 'page');
});
const outline = document.querySelector('#page-outline');
document.querySelectorAll('.document h2[id]').forEach(heading => {
  const link = document.createElement('a');
  link.href = `#${heading.id}`;
  link.textContent = heading.textContent;
  outline.append(link);
});
if (outline.childElementCount) outline.parentElement.hidden = false;
document.querySelectorAll('.document table').forEach(table => {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', ui.scroll_table);
  table.before(wrapper);
  wrapper.append(table);
});
document.querySelectorAll('.document img[src$=".svg"]').forEach(image => {
  const wrapper = document.createElement('div');
  wrapper.className = 'diagram-scroll';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', ui.scroll_diagram);
  image.before(wrapper);
  wrapper.append(image);
});
