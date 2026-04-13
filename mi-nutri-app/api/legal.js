// GET /api/legal?page=privacy or /api/legal?page=terms
export default function handler(req, res) {
  const page = req.query.page || "privacy";
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const style = `<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#0A0F1A;color:#E2E8F0;line-height:1.7}h1{color:#fff;font-size:28px}h2{color:#60A5FA;font-size:20px;margin-top:32px}a{color:#60A5FA}</style>`;

  if (page === "terms") {
    return res.status(200).send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Términos - Mi Nutri</title>${style}</head><body>
<h1>📋 Términos de Uso</h1><p><strong>Mi Nutri</strong> — Abril 2026</p>
<h2>1. Aceptación</h2><p>Al usar Mi Nutri aceptas estos términos.</p>
<h2>2. Servicio</h2><p>App de seguimiento nutricional con registro de alimentos, recetas, planes con IA y reels de cocina.</p>
<h2>3. Uso aceptable</h2><p>No publicar contenido ofensivo, no spam, no acceder a cuentas ajenas.</p>
<h2>4. Información nutricional</h2><p>Los datos y planes de IA son orientativos. Consulta un profesional de la salud.</p>
<h2>5. Contenido</h2><p>Eres responsable de lo que publicas. Tu contenido sigue siendo tuyo.</p>
<h2>6. Limitación</h2><p>Mi Nutri se proporciona "tal cual" sin garantías.</p>
<h2>7. Contacto</h2><p><a href="mailto:contact@minutri.app">contact@minutri.app</a></p>
</body></html>`);
  }

  return res.status(200).send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacidad - Mi Nutri</title>${style}</head><body>
<h1>🔒 Política de Privacidad</h1><p><strong>Mi Nutri</strong> — Abril 2026</p>
<h2>1. Datos</h2><p>Recopilamos nombre, email, peso, altura, edad, sexo, actividad y objetivo. También alimentos, recetas y reels.</p>
<h2>2. Uso</h2><p>Calcular objetivos nutricionales, generar planes con IA, mostrar contenido relevante.</p>
<h2>3. Almacenamiento</h2><p>Supabase (UE/EEUU) y AsyncStorage local. Fotos/vídeos en Supabase Storage.</p>
<h2>4. IA</h2><p>Anthropic Claude procesa fotos en tiempo real sin almacenarlas.</p>
<h2>5. Compartir</h2><p>No vendemos datos. Reels y recetas publicados son visibles para otros usuarios.</p>
<h2>6. Derechos</h2><p>Accede, modifica o elimina tus datos desde Ajustes.</p>
<h2>7. Contacto</h2><p><a href="mailto:contact@minutri.app">contact@minutri.app</a></p>
</body></html>`);
}
