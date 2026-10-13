const root = document.documentElement;
const toggle = document.querySelector('#theme-toggle');
function updateToggle() {
  const dark = root.dataset.theme === 'dark';
  toggle.textContent = dark ? 'Light mode' : 'Dark mode';
  toggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
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
  wrapper.setAttribute('aria-label', 'Scrollable documentation table');
  table.before(wrapper);
  wrapper.append(table);
});
