# JuCut — Editor de Silêncio Online 🎬✂️

> Editor de vídeo online inteligente que detecta e remove silêncios automaticamente, diretamente no seu navegador.

## 🚀 [Abrir JuCut](https://seu-usuario.github.io/JuCut)

---

## ✨ Funcionalidades

- **Upload de vídeos** até 2GB (MP4, MOV, AVI, MKV)
- **⚡ Exportação Ultra-Rápida (3 a 15 segundos para 1GB)**:
  - **Opção 1 (Servidor Local Nativo)**: execute `iniciar.bat` no seu computador para corte acelerado via FFmpeg Nativo (GPU/CPU).
  - **Opção 2 (Script .BAT de 2 Cliques)**: baixe o arquivo `.bat` gerado pelo editor, coloque na pasta do vídeo e execute (corta em ~3s via *stream copy* sem re-encode e sem perda de qualidade).
  - **Opção 3 (Navegador WASM)**: fallback 100% no browser sem instalar nada para vídeos curtos.
- **100% Responsivo para Mobile & Tablets** — barra de navegação inferior estilo app, gaveta de ajustes e controles táteis
- **Gestos Touch** — arraste com o dedo na timeline (scrubbing), toque no player para Play/Pause e pinça com 2 dedos para zoom (pinch-to-zoom)
- **Detecção inteligente de silêncio** usando análise de forma de onda (RMS)
- **Timeline interativa** com visualização de waveform e regiões de silêncio
- **Ajuste de parâmetros** — threshold, duração mínima, margem e velocidade de fala
- **Design moderno escuro** inspirado em editores profissionais (DaVinci Resolve, Premiere Pro)

## ⚡ Como Exportar Vídeos Grandes (500MB - 1GB) em Segundos

### Opção A — Servidor Local Integrado (Recomendado)
1. Dê dois cliques em [`iniciar.bat`](file:///c:/Users/59598/Downloads/JuCut/iniciar.bat) (ele abre o navegador com o motor local ativo).
2. O editor mostrará o badge **⚡ Motor Local Ativo**.
3. Ao clicar em **Exportar Vídeo**, o corte é feito na velocidade máxima do seu processador/placa de vídeo.

### Opção B — Download do Script .BAT (Sem Servidor)
1. Use o editor normalmente (inclusive no GitHub Pages).
2. Na janela de exportação, selecione **Baixar Script de Corte (.bat)**.
3. Coloque o arquivo `.bat` baixado na mesma pasta do seu vídeo original e dê dois cliques.
4. O vídeo sem silêncios é gerado em cerca de **3 segundos** usando corte *lossless* (sem perda de qualidade).

## 🛠️ Tecnologias

| Tecnologia | Uso |
|---|---|
| **FFmpeg.wasm** | Processamento de vídeo no browser |
| **Web Audio API** | Decodificação e análise de áudio |
| **Canvas API** | Timeline e waveform |
| **HTML/CSS/JS puro** | Sem framework, máxima compatibilidade |

## 📖 Como Usar

1. Acesse o app pelo link acima
2. Clique ou arraste um vídeo para a área de upload
3. Ajuste os parâmetros de detecção de silêncio:
   - **Threshold**: sensibilidade (quanto mais baixo, mais silêncios detectados)
   - **Duração Mínima**: mínimo de segundos para um trecho ser considerado silêncio
   - **Margem**: segundos extra preservados ao redor de cada fala
   - **Velocidade**: acelerar a fala (opcional)
4. Clique em **Detectar Silêncios**
5. Revise os cortes na timeline
6. Clique em **Exportar Vídeo** e baixe o resultado

## 🏗️ Hospedar no GitHub Pages

```bash
# 1. Crie um repositório público no GitHub chamado "JuCut"
# 2. Faça upload dos arquivos:
git init
git add .
git commit -m "feat: initial JuCut release"
git remote add origin https://github.com/SEU-USUARIO/JuCut.git
git push -u origin main

# 3. Vá em Settings > Pages > Source: main branch / root folder
# 4. Aguarde 1-2 minutos e acesse: https://seu-usuario.github.io/JuCut
```

## ⚠️ Notas Importantes

- **Processamento local**: o vídeo NUNCA é enviado para nenhum servidor
- **Memória**: para vídeos grandes (>500MB) recomenda-se Chrome com 8GB+ RAM
- **FFmpeg.wasm**: requer `SharedArrayBuffer`, ativado por padrão no GitHub Pages com COOP/COEP

## 📁 Estrutura

```
JuCut/
├── index.html      # Interface principal
├── style.css       # Design system completo
├── app.js          # Lógica da aplicação
└── README.md       # Este arquivo
```

---

Made with ❤️ — processamento de vídeo 100% no browser
