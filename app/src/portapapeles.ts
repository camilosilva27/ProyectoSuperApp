import { Platform } from 'react-native';

/**
 * Copia al portapapeles en web. Se llama directo desde el toque, sin `await` antes: Safari
 * rechaza `clipboard.writeText` fuera del gesto del usuario (WebKit bug 222262). En nativo no
 * hay portapapeles sin una dependencia nueva (no hay build nativo todavía): devuelve false y el
 * aviso sugiere copiarlo a mano (el link es texto seleccionable).
 */
export async function copiarAlPortapapeles(contenido: string): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  try {
    await navigator.clipboard.writeText(contenido);
    return true;
  } catch {
    // Navegadores sin Clipboard API (o sin permiso): el camino viejo.
    try {
      const area = document.createElement('textarea');
      area.value = contenido;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
