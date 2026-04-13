// GET /api/privacy — Privacy Policy page
export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Política de Privacidad - Mi Nutri</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#0A0F1A;color:#E2E8F0;line-height:1.7}
h1{color:#fff;font-size:28px}h2{color:#60A5FA;font-size:20px;margin-top:32px}a{color:#60A5FA}</style></head>
<body>
<h1>🔒 Política de Privacidad</h1>
<p><strong>Mi Nutri</strong> — Última actualización: abril 2026</p>

<h2>1. Datos que recopilamos</h2>
<p>Recopilamos los datos que proporcionas voluntariamente: nombre, email, peso, altura, edad, sexo, nivel de actividad y objetivo nutricional. También almacenamos los alimentos que registras, recetas que creas, y reels que publicas.</p>

<h2>2. Uso de los datos</h2>
<p>Usamos tus datos para: calcular tus objetivos nutricionales, generar planes de comidas personalizados con IA, permitirte registrar tu alimentación diaria, y mostrar contenido relevante en reels.</p>

<h2>3. Almacenamiento</h2>
<p>Tus datos se almacenan en Supabase (servidores en la UE/EEUU) y localmente en tu dispositivo via AsyncStorage. Los vídeos y fotos se almacenan en Supabase Storage.</p>

<h2>4. Inteligencia Artificial</h2>
<p>Las funciones de análisis de fotos y plan semanal utilizan la API de Anthropic (Claude). Las imágenes enviadas se procesan en tiempo real y no se almacenan en los servidores de Anthropic.</p>

<h2>5. Compartir datos</h2>
<p>No vendemos ni compartimos tus datos personales con terceros. Los reels y recetas publicados son visibles para otros usuarios de la plataforma.</p>

<h2>6. Tus derechos</h2>
<p>Puedes acceder, modificar o eliminar tus datos en cualquier momento desde Ajustes. Para eliminar tu cuenta completamente, usa la opción "Cerrar cuenta" en Ajustes.</p>

<h2>7. Contacto</h2>
<p>Para consultas sobre privacidad: <a href="mailto:contact@minutri.app">contact@minutri.app</a></p>
</body></html>`);
}
