// GET /api/landing — Landing page de Mi Nutri
export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mi Nutri — Tu asistente de nutrición personalizado</title>
<meta name="description" content="Registra tu alimentación, crea recetas, genera planes semanales con IA y comparte reels de cocina. Gratis.">
<meta property="og:title" content="Mi Nutri — Nutrición inteligente">
<meta property="og:description" content="Registra comidas, genera planes con IA, comparte reels de cocina">
<meta property="og:type" content="website">
<meta property="og:url" content="https://mi-nutri-app-theta.vercel.app">
<meta name="theme-color" content="#000000">
<link rel="icon" href="/assets/images/logo.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0A0F1A;color:#E2E8F0;overflow-x:hidden}
a{text-decoration:none;color:inherit}

/* Hero */
.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle at 30% 40%,rgba(31,111,235,0.12) 0%,transparent 50%),radial-gradient(circle at 70% 60%,rgba(139,92,246,0.08) 0%,transparent 50%);animation:drift 20s ease infinite alternate}
@keyframes drift{0%{transform:translate(0,0)}100%{transform:translate(-5%,3%)}}
.hero-content{position:relative;z-index:1;max-width:640px}
.logo{font-size:80px;margin-bottom:16px}
h1{font-size:clamp(36px,6vw,56px);font-weight:900;letter-spacing:-1.5px;line-height:1.1;margin-bottom:16px}
h1 span{background:linear-gradient(135deg,#60A5FA,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{font-size:clamp(16px,2.5vw,20px);color:#94A3B8;line-height:1.6;margin-bottom:40px}
.cta-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.btn{padding:16px 36px;border-radius:16px;font-size:17px;font-weight:800;cursor:pointer;border:none;transition:transform 0.15s,box-shadow 0.15s}
.btn:hover{transform:translateY(-2px)}
.btn-primary{background:linear-gradient(135deg,#1F6FEB,#8B5CF6);color:#fff;box-shadow:0 8px 32px rgba(31,111,235,0.3)}
.btn-secondary{background:rgba(255,255,255,0.08);color:#fff;border:1.5px solid rgba(255,255,255,0.15)}
.btn-secondary:hover{background:rgba(255,255,255,0.12)}

/* Features */
.features{padding:80px 24px;max-width:1100px;margin:0 auto}
.features h2{text-align:center;font-size:32px;font-weight:900;margin-bottom:48px}
.features h2 span{background:linear-gradient(135deg,#4ADE80,#60A5FA);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:28px;transition:transform 0.2s,border-color 0.2s}
.card:hover{transform:translateY(-4px);border-color:rgba(255,255,255,0.15)}
.card-icon{font-size:40px;margin-bottom:14px}
.card h3{font-size:18px;font-weight:800;margin-bottom:8px;color:#fff}
.card p{color:#94A3B8;font-size:14px;line-height:1.6}

/* AI Section */
.ai-section{padding:80px 24px;text-align:center;position:relative}
.ai-section::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent,rgba(139,92,246,0.06),transparent)}
.ai-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:40px;padding:8px 20px;font-size:13px;font-weight:700;color:#C4B5FD;margin-bottom:24px}
.ai-section h2{font-size:32px;font-weight:900;margin-bottom:16px;position:relative;z-index:1}
.ai-section p{color:#94A3B8;font-size:16px;max-width:500px;margin:0 auto 32px;line-height:1.6;position:relative;z-index:1}
.ai-features{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;position:relative;z-index:1}
.ai-card{background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:16px;padding:24px;width:220px;text-align:center}
.ai-card .icon{font-size:36px;margin-bottom:10px}
.ai-card h4{color:#C4B5FD;font-size:15px;font-weight:800;margin-bottom:6px}
.ai-card p{color:#94A3B8;font-size:13px;margin:0}

/* Social */
.social{padding:60px 24px;text-align:center}
.social h2{font-size:28px;font-weight:900;margin-bottom:32px}
.social-grid{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.social-item{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px 28px;text-align:center}
.social-item .num{font-size:28px;font-weight:900;color:#4ADE80}
.social-item .label{color:#94A3B8;font-size:12px;margin-top:4px}

/* Footer */
footer{padding:40px 24px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);color:#475569;font-size:13px}
footer a{color:#60A5FA;margin:0 12px}
footer a:hover{text-decoration:underline}

/* CTA bottom */
.cta-bottom{padding:60px 24px;text-align:center}
.cta-bottom h2{font-size:28px;font-weight:900;margin-bottom:12px}
.cta-bottom p{color:#94A3B8;margin-bottom:28px;font-size:15px}
</style>
</head>
<body>

<!-- Hero -->
<section class="hero">
  <div class="hero-content">
    <div class="logo">🥗</div>
    <h1>Tu nutrición, <span>inteligente</span></h1>
    <p class="subtitle">Registra lo que comes, genera planes semanales con IA, comparte recetas en reels y alcanza tus objetivos. Todo en una app.</p>
    <div class="cta-row">
      <a href="/" class="btn btn-primary">Abrir Mi Nutri →</a>
      <a href="#features" class="btn btn-secondary">Ver funciones</a>
    </div>
  </div>
</section>

<!-- Features -->
<section class="features" id="features">
  <h2>Todo lo que <span>necesitas</span></h2>
  <div class="grid">
    <div class="card">
      <div class="card-icon">📊</div>
      <h3>Registro diario</h3>
      <p>Añade alimentos por nombre, código de barras o foto. Controla calorías, proteínas, carbs y grasas al instante.</p>
    </div>
    <div class="card">
      <div class="card-icon">🍳</div>
      <h3>Recetas personales</h3>
      <p>Crea tus recetas con ingredientes y macros calculados automáticamente. Compártelas con la comunidad.</p>
    </div>
    <div class="card">
      <div class="card-icon">🎬</div>
      <h3>Reels de cocina</h3>
      <p>Graba y comparte vídeos de tus recetas como en TikTok. Dale like, comenta y descubre nuevas ideas.</p>
    </div>
    <div class="card">
      <div class="card-icon">📈</div>
      <h3>Seguimiento semanal</h3>
      <p>Registra tu peso cada semana, ajusta calorías automáticamente según tu progreso y objetivo.</p>
    </div>
    <div class="card">
      <div class="card-icon">🌍</div>
      <h3>30 idiomas</h3>
      <p>Disponible en español, inglés, francés, alemán, chino y 25 idiomas más. La nutrición no tiene fronteras.</p>
    </div>
    <div class="card">
      <div class="card-icon">🔒</div>
      <h3>Privacidad primero</h3>
      <p>Tus datos son tuyos. Sin anuncios, sin vender información. Cuenta privada opcional.</p>
    </div>
  </div>
</section>

<!-- AI Section -->
<section class="ai-section">
  <div class="ai-badge">✨ Inteligencia Artificial</div>
  <h2>Nutrición potenciada con IA</h2>
  <p>Claude AI analiza tus fotos de comida y genera planes personalizados basados en tu perfil.</p>
  <div class="ai-features">
    <div class="ai-card">
      <div class="icon">📸</div>
      <h4>Foto → Macros</h4>
      <p>Haz una foto a tu plato y la IA calcula calorías y macros al instante</p>
    </div>
    <div class="ai-card">
      <div class="icon">📋</div>
      <h4>Plan semanal</h4>
      <p>7 días de comidas personalizadas según tu objetivo, alergias y presupuesto</p>
    </div>
    <div class="ai-card">
      <div class="icon">🔄</div>
      <h4>Alternativas</h4>
      <p>Cada comida e ingrediente tiene alternativas con macros similares</p>
    </div>
  </div>
</section>

<!-- CTA bottom -->
<section class="cta-bottom">
  <h2>Empieza hoy, gratis</h2>
  <p>Sin tarjeta de crédito. Sin anuncios. Solo tú y tu nutrición.</p>
  <a href="/" class="btn btn-primary">Empezar ahora →</a>
</section>

<!-- Footer -->
<footer>
  <p>© 2026 Mi Nutri. Todos los derechos reservados.</p>
  <p style="margin-top:12px">
    <a href="/api/privacy">Privacidad</a>
    <a href="/api/terms">Términos</a>
  </p>
</footer>

</body>
</html>`);
}
