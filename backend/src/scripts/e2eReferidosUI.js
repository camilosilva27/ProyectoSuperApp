// Test de punta a punta de referidos POR LA INTERFAZ (Playwright) contra la base REAL
// (.claude/docs/PLAN_REFERIDOS.md § Verificación). Crea cuentas temporales
// prueba-ref-e2e-*@superahorro.com.ar (les llegan mails de confirmación/bienvenida al catch-all
// de contacto@) y las borra al final.
//
//   node backend/src/scripts/e2eReferidosUI.js [BASE_URL]   (default http://localhost:8082)
//
// Local: backend en :3000 + `EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start --web
// --port 8082`. Producción: BASE_URL=https://superahorro.com.ar. Playwright no es dependencia del
// repo: se toma de PLAYWRIGHT_PATH o del cache de npx (ver memoria verificacion-navegador-playwright).
// Capturas en SCREENSHOTS_DIR (default: el tmp del sistema).
//
// 1. Quien invita (cuenta creada por admin) entra a Ajustes → Invitá amigos y copia su link.
// 2. Tres personas abren el link, se registran con el formulario (aceptando términos),
//    se les confirma el mail (admin) e inician sesión — la 2da desde otro "dispositivo"
//    (contexto nuevo, sin el código guardado: prueba el camino user_metadata.ref).
// 3. Cada una hace el tutorial completo; su comparación tiene que validarla.
// 4. La pantalla de quien invita refleja cada paso; con la tercera, el premio.
// Al final borra todas las cuentas creadas.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');

function cargarPlaywright() {
  if (process.env.PLAYWRIGHT_PATH) return require(process.env.PLAYWRIGHT_PATH);
  try { return require('playwright'); } catch { /* no instalado en el repo */ }
  const npx = path.join(os.homedir(), '.npm', '_npx');
  for (const dir of fs.existsSync(npx) ? fs.readdirSync(npx) : []) {
    const candidato = path.join(npx, dir, 'node_modules', 'playwright');
    if (fs.existsSync(candidato)) return require(candidato);
  }
  throw new Error('No encontré Playwright: instalalo (npx playwright install chromium) o pasá PLAYWRIGHT_PATH');
}
const { chromium } = cargarPlaywright();
const admin = clienteSupabaseAdmin();

const BASE = (process.argv[2] || 'http://localhost:8082').replace(/\/+$/, '');
const SCR = process.env.SCREENSHOTS_DIR || os.tmpdir();
const SUF = Date.now().toString(36);
const PASS = 'Prueba' + Math.random().toString(36).slice(2, 8) + '9X';
const creados = [];
let fallas = 0;
const check = (cond, msg) => { console.log(`${cond ? 'OK   ' : 'FALLA'} ${msg}`); if (!cond) fallas++; return cond; };

async function usuarioPorMail(email) {
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return users.find(u => u.email === email) ?? null;
}

async function login(page, email) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder="Mail"]', { timeout: 60000 });
  const toggle = page.getByText('¿Ya tenés cuenta? Iniciá sesión');
  if (await toggle.count()) await toggle.click();
  await page.fill('input[placeholder="Mail"]', email);
  await page.fill('input[placeholder="Contraseña"]', PASS);
  await page.getByText('ENTRAR', { exact: true }).click();
}

async function paso(page, titulo, accion, nombre) {
  try {
    await page.getByText(titulo, { exact: true }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    await accion();
    return true;
  } catch (e) {
    await page.screenshot({ path: `${SCR}/e2e-falla-${nombre}.png` });
    check(false, `tutorial: paso "${titulo}" (${e.message.split('\n')[0]})`);
    return false;
  }
}

const compararAntesDeTocar = { n: null };
let comparar = [];
async function hacerTutorial(page, nombre) {
  const tab = t => page.getByText(t, { exact: true }).last().click();
  const pasos = [
    ['Cargá tus descuentos', () => tab('Descuentos')],
    ['Activá Mercado Pago', () => page.getByText('Mercado Pago', { exact: true }).first().click()],
    ['Volvé a Buscar', () => tab('Buscar')],
    ['Buscá un producto', () => page.fill('input[placeholder="yerba, fideos, shampoo…"]', 'yerba')],
    ['Agregá al carrito', async () => { await page.waitForTimeout(2500); await page.getByText(/yerba/i).first().click(); }],
    ['Elegí los supermercados', () => page.getByText('otros', { exact: true }).first().click()],
    ['Sumá o sacá un super', () => page.getByText('Coto', { exact: true }).last().click()],
    ['Poné un máximo de supermercados', () => page.getByRole('button', { name: 'Como mucho 2 supers' }).click()],
    ['Confirmá tu selección', () => page.getByText('Listo', { exact: true }).last().click()],
    ['Mirá tu carrito', () => page.getByText('Ver carrito', { exact: true }).click()],
    ['Comparar precios', async () => { compararAntesDeTocar.n = comparar.length; await page.getByRole('button', { name: /Comparar precios/ }).first().click(); }],
    ['Así ahorrás', async () => {
      await page.getByText('Finalizar', { exact: true }).last().click();
      // "Finalizar" cierra el tutorial en cualquier paso: el cartel tiene que desaparecer.
      await page.getByText('Así ahorrás', { exact: true }).first().waitFor({ state: 'hidden', timeout: 10000 });
    }],
  ];
  for (const [titulo, accion] of pasos) {
    if (!(await paso(page, titulo, accion, `${nombre}-${titulo.slice(0, 12)}`))) return false;
  }
  return true;
}

async function estadoInvitadora(page, nombre) {
  await page.goto(BASE + '/ajustes/invitar', { waitUntil: 'domcontentloaded' });
  await page.getByText('INVITÁ AMIGOS', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SCR}/e2e-invitadora-${nombre}.png`, fullPage: true });
  return page.evaluate(() => document.body.innerText);
}

(async () => {
  const browser = await chromium.launch();
  try {
    // --- Quien invita --------------------------------------------------------------------
    const emailInv = `prueba-ref-e2e-invita-${SUF}@superahorro.com.ar`;
    const { data: inv, error } = await admin.auth.admin.createUser({
      email: emailInv, password: PASS, email_confirm: true, user_metadata: { nombre: 'Ana Invitadora' },
    });
    if (error) throw error;
    creados.push(inv.user.id);
    await admin.from('perfil_usuario').update({ tour_visto: true }).eq('id', inv.user.id);
    const trialAntes = (await admin.from('perfil_usuario').select('trial_termina_en').eq('id', inv.user.id).single()).data.trial_termina_en;

    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const pA = await ctxA.newPage();
    await login(pA, emailInv);
    await pA.waitForTimeout(4000);
    await pA.goto(BASE + '/ajustes', { waitUntil: 'domcontentloaded' });
    await pA.getByText('Invitá amigos', { exact: true }).waitFor({ timeout: 30000 });
    await pA.waitForTimeout(1500);
    check(await pA.getByText('Invitá a 3 y llevate 2 meses gratis').count() > 0, 'Ajustes: fila "Invitá amigos" con "Invitá a 3 y llevate 2 meses gratis"');
    await pA.getByText('Invitá amigos', { exact: true }).click();
    await pA.getByText('Copiar link', { exact: true }).waitFor({ timeout: 30000 });
    check(await pA.getByText('Compartir', { exact: true }).count() === 0, 'no hay botón Compartir');
    await pA.getByText('Copiar link', { exact: true }).click();
    await pA.waitForTimeout(500);
    const link = await pA.evaluate(() => navigator.clipboard.readText());
    const codigo = (link.match(/[?&]ref=([A-Z0-9]+)/) || [])[1];
    check(!!codigo && /^https:\/\/superahorro\.com\.ar\/\?ref=[A-Z0-9]{6}$/.test(link), `"Copiar link" copió ${link}`);
    check(await pA.getByText('Copiamos tu link: pegalo donde quieras.').count() > 0, 'aviso "Copiamos tu link"');

    // --- Tres invitadas por la interfaz ------------------------------------------------------
    const invitadas = [
      { nombre: 'Martina Gómez', pila: 'Martina', otroDispositivo: false },
      { nombre: 'Lucas Pereyra', pila: 'Lucas', otroDispositivo: true },
      { nombre: 'Sofía Ruiz', pila: 'Sofía', otroDispositivo: false },
    ];
    for (const [i, inv2] of invitadas.entries()) {
      const n = i + 1;
      console.log(`\n--- Invitada ${n}: ${inv2.nombre}${inv2.otroDispositivo ? ' (confirma y entra desde otro dispositivo)' : ''} ---`);
      const email = `prueba-ref-e2e-${n}-${SUF}@superahorro.com.ar`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx.newPage();
      const errores = [];
      p.on('pageerror', e => errores.push(e.message.slice(0, 150)));
      const asociar = [];
      let t0 = Date.now();
      comparar = [];
      compararAntesDeTocar.n = null;
      p.on('response', async r => {
        if (r.url().includes('/api/referidos/asociar')) asociar.push(`${(await r.json().catch(() => ({}))).resultado ?? r.status()}@${((Date.now() - t0) / 1000).toFixed(1)}s`);
        if (r.url().includes('/api/comparar')) comparar.push(r.status());
      });

      // Llega con el link (el de producción, apuntado a BASE si es local).
      await p.goto(`${BASE}/?ref=${codigo}`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('input[placeholder="Nombre"]', { timeout: 60000 });
      if (n === 1) {
        await p.getByText('Términos de Servicio', { exact: true }).first().click();
        await p.getByText('Cerrar', { exact: true }).first().waitFor({ timeout: 10000 });
        check(await p.getByText('5. Programa "Invitá amigos"').first().isVisible(), 'los Términos del registro incluyen la sección 5 "Invitá amigos"');
        await p.getByText('Cerrar', { exact: true }).first().click();
      }
      await p.fill('input[placeholder="Nombre"]', inv2.nombre);
      await p.fill('input[placeholder="Mail"]', email);
      await p.fill('input[placeholder="Contraseña"]', PASS);
      await p.fill('input[placeholder="Repetí tu contraseña"]', PASS);
      await p.getByRole('checkbox').click();
      await p.getByText('CONTINUAR', { exact: true }).click();
      await p.getByText('Te mandamos un mail', { exact: true }).waitFor({ timeout: 30000 });
      const u = await usuarioPorMail(email);
      creados.push(u.id);
      check(u.user_metadata?.ref === codigo, `registro: user_metadata.ref = ${u.user_metadata?.ref}`);
      await admin.auth.admin.updateUserById(u.id, { email_confirm: true });

      let pagina = p;
      if (inv2.otroDispositivo) {
        const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
        pagina = await ctx2.newPage();
        pagina.on('pageerror', e => errores.push(e.message.slice(0, 150)));
        pagina.on('response', async r => {
          if (r.url().includes('/api/referidos/asociar')) asociar.push(`${(await r.json().catch(() => ({}))).resultado ?? r.status()}@${((Date.now() - t0) / 1000).toFixed(1)}s`);
          if (r.url().includes('/api/comparar')) comparar.push(r.status());
        });
        check(await pagina.evaluate(() => null) === null, 'otro dispositivo: contexto nuevo, sin código guardado');
      }
      t0 = Date.now();
      await login(pagina, email);
      for (let k = 0; k < 60 && !asociar.length; k++) await pagina.waitForTimeout(500);
      check(String(asociar[0]).startsWith('asociada'), `asociación al iniciar sesión: ${asociar[0]} (segundos desde que tocó ENTRAR)`);

      const tutorialOk = await hacerTutorial(pagina, `inv${n}`);
      check(tutorialOk, 'tutorial completo de punta a punta');
      check(comparar.includes(200), `POST /api/comparar → ${comparar.join(',') || 'nada'} (antes de tocar "Comparar precios" del tutorial: ${compararAntesDeTocar.n})`);
      await pagina.waitForTimeout(3000);
      const fila = (await admin.from('referido').select('estado, primera_comparacion_en').eq('invitada_id', u.id).single()).data;
      check(fila?.estado === 'valida', `base: la invitada quedó '${fila?.estado}'`);
      check(errores.length === 0, `sin errores de página${errores.length ? ': ' + errores.join(' | ') : ''}`);
      console.log(`      (pedidos a /api/referidos/asociar vistos: ${asociar.join(', ') || 'ninguno'})`);

      const texto = await estadoInvitadora(pA, `tras-${n}`);
      check(texto.includes(inv2.pila) && !texto.includes(inv2.nombre), `pantalla de quien invita muestra "${inv2.pila}" (sin apellido)`);
      if (n < 3) check(texto.includes(`${n} de 3`), `progreso "${n} de 3"`);
      await ctx.close();
    }

    // --- Premio ------------------------------------------------------------------------------
    const texto = await estadoInvitadora(pA, 'final');
    check(texto.includes('GANASTE') && texto.includes('2 MESES GRATIS'), 'pantalla: bloque "GANASTE · 2 MESES GRATIS"');
    const trialDespues = (await admin.from('perfil_usuario').select('trial_termina_en').eq('id', inv.user.id).single()).data.trial_termina_en;
    const dias = Math.round((new Date(trialDespues) - new Date(trialAntes)) / 86400000);
    check(dias === 60, `base: la prueba de quien invita se extendió ${dias} días`);
    let mailEn = null;
    for (let k = 0; k < 20 && !mailEn; k++) {
      mailEn = (await admin.from('premio_referido').select('mail_enviado_en').eq('usuario_id', inv.user.id).single()).data?.mail_enviado_en;
      if (!mailEn) await new Promise(r => setTimeout(r, 1000));
    }
    check(!!mailEn, `mail "¡Ganaste 2 meses gratis!" enviado a ${emailInv} (${mailEn ?? 'no salió'})`);
    await pA.goto(BASE + '/ajustes', { waitUntil: 'domcontentloaded' });
    await pA.getByText('Invitá amigos', { exact: true }).waitFor({ timeout: 30000 });
    await pA.waitForTimeout(2000);
    await pA.screenshot({ path: `${SCR}/e2e-ajustes-final.png` });
    const ajustes = await pA.evaluate(() => document.body.innerText);
    check(ajustes.includes('Ganaste 2 meses gratis'), 'Ajustes: "Ganaste 2 meses gratis"');
    check(/vence en (8[89]|9[01]) día/.test(ajustes), `Ajustes: ${(ajustes.match(/Prueba gratis · vence en \d+ día\(s\)/) || ['(sin texto de prueba)'])[0]}`);
  } catch (e) {
    console.error('ERROR', e);
    fallas++;
  } finally {
    await browser.close();
    for (const id of creados) await admin.auth.admin.deleteUser(id);
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
    console.log(`\nCuentas de prueba borradas: ${creados.length} (quedan prueba-ref: ${users.filter(u => u.email?.startsWith('prueba-ref-')).length})`);
    console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTODO OK');
  }
})();
