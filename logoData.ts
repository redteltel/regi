
// Logo image path
// Please place your 'logo.png' file in the 'public' directory of your project.
// This path handles the Vite base URL configuration automatically.

const BASE = import.meta.env.BASE_URL || '/';
// Remove trailing slash from BASE if it exists, to avoid double slashes if not careful, 
// but BASE_URL usually ends with /. 
// If BASE is '/', result is '/logo.png'. If '/regi/', result is '/regi/logo.png'.
export const LOGO_URL = `${BASE}logo.png`.replace(/\/\//g, '/');
