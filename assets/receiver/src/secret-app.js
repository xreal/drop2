import { startCreate } from './secret-create.js';
import { startReveal } from './secret-reveal.js';

const revealPath = location.pathname.match(/^\/secret\/([A-Za-z0-9]{12})$/);

// Pasting another secret link into this tab only changes the fragment, which never reloads the page.
addEventListener('hashchange', () => location.reload());

if (revealPath) {
  document.title = 'A secret for you · drop2';
  startReveal(revealPath[1]);
} else {
  startCreate();
}
