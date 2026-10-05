# JuCut — Editor de Silêncio Online 🎬✂️

> Editor de vídeo online inteligente que detecta e remove silêncios automaticamente, diretamente no seu navegador.

## 🚀 [Abrir JuCut](https://seu-usuario.github.io/JuCut)

---

## ✨ Funcionalidades

- **Upload de vídeos** até 2GB (MP4, MOV, AVI, MKV)
- **Detecção inteligente de silêncio** usando análise de forma de onda (RMS)
- **Timeline interativa** com visualização de waveform e regiões de silêncio
- **Ajuste de parâmetros** — threshold, duração mínima, margem e velocidade de fala
- **Exportação com FFmpeg.wasm** — processamento 100% no navegador, sem servidor
- **Design moderno escuro** inspirado em editores profissionais (DaVinci Resolve, Premiere Pro)

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
