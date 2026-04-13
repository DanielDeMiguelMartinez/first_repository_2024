// GET /api/terms — Terms of Service page
export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Términos de Uso - Mi Nutri</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#0A0F1A;color:#E2E8F0;line-height:1.7}
h1{color:#fff;font-size:28px}h2{color:#60A5FA;font-size:20px;margin-top:32px}a{color:#60A5FA}</style></head>
<body>
<h1>📋 Términos de Uso</h1>
<p><strong>Mi Nutri</strong> — Última actualización: abril 2026</p>

<h2>1. Aceptación</h2>
<p>Al usar Mi Nutri aceptas estos términos. Si no estás de acuerdo, no uses la aplicación.</p>

<h2>2. Descripción del servicio</h2>
<p>Mi Nutri es una aplicación de seguimiento nutricional que permite registrar alimentos, crear recetas, establecer objetivos calóricos, generar planes de comidas con IA, y compartir contenido con otros usuarios.</p>

<h2>3. Uso aceptable</h2>
<p>Te comprometes a: no publicar contenido ofensivo o ilegal en reels, no hacer spam, no intentar acceder a cuentas ajenas, y no usar la app para fines distintos al seguimiento nutricional.</p>

<h2>4. Información nutricional</h2>
<p>La información nutricional y los planes generados por IA son orientativos. Mi Nutri no sustituye el consejo de un profesional de la salud. Consulta a un médico o dietista antes de hacer cambios significativos en tu dieta.</p>

<h2>5. Contenido del usuario</h2>
<p>Eres responsable del contenido que publicas (reels, recetas, comentarios). Nos reservamos el derecho de eliminar contenido que viole estos términos.</p>

<h2>6. Propiedad intelectual</h2>
<p>Mi Nutri y su código son propiedad de sus desarrolladores. Tu contenido (recetas, reels) sigue siendo tuyo.</p>

<h2>7. Limitación de responsabilidad</h2>
<p>Mi Nutri se proporciona "tal cual". No garantizamos la precisión de los datos nutricionales ni la disponibilidad continua del servicio.</p>

<h2>8. Contacto</h2>
<p><a href="mailto:contact@minutri.app">contact@minutri.app</a></p>
</body></html>`);
}
