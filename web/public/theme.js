// Apply the saved light/dark choice before the page draws, to avoid a flash.
try { var t = localStorage.getItem('theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
// Home page for a visitor without a saved sign-in: show the HTML first screen while the app loads.
try {
  var home = location.pathname === '/' || location.pathname === '/website';
  var signedIn = Object.keys(localStorage).some(function (k) { return k.indexOf('sb-') === 0 && /-auth-token$/.test(k); });
  if (home && !signedIn) document.documentElement.classList.add('boot-home');
} catch (e) {}
