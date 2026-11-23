/**
 * Runs before React paints to avoid a dark/light flash on navigation.
 * Storage and matchMedia may fail independently in restricted browsers,
 * so neither exception should override an otherwise usable preference.
 */
export const themeBootstrapScript = `(function(){
  var saved=null;
  var systemDark=false;
  try { saved=window.localStorage.getItem("interpretes-rd-theme"); } catch(e) {}
  try { systemDark=typeof window.matchMedia==="function" && window.matchMedia("(prefers-color-scheme: dark)").matches; } catch(e) {}
  var dark=saved==="dark"||(saved!=="light"&&systemDark);
  document.documentElement.dataset.theme=dark?"dark":"light";
  document.documentElement.style.colorScheme=dark?"dark":"light";
})();`;
