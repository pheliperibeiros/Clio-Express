# Clio — Gravador de Oitivas e Audiências

Sistema institucional de gravação audiovisual para oitivas e audiências, com:

- 🎥 Suporte a 2 câmeras simultâneas (split, PiP ou câmera única)
- 🎙️ Motor de áudio com VU-meter em tempo real e controle de ganho
- 🤖 Auto-enquadramento por rastreamento facial (PTZ virtual)
- 🛡️ Gravação tolerante a falhas com journaling em IndexedDB
- 💾 Persistência nativa de chunks no disco via backend Tauri
- 📄 Extrato jurídico em PDF com hash SHA-256 e cadeia de custódia
- ⚙️ Configurações institucionais personalizáveis (logo, cabeçalho, templates)

---

## Requisitos de desenvolvimento

| Ferramenta | Versão mínima |
|-----------|---------------|
| Node.js   | 20 LTS        |
| npm       | 10            |
| Rust      | 1.77.2 (stable) |
| Tauri CLI | 2.x           |

## Instalação das dependências

```bash
npm install
```

## Desenvolvimento (frontend apenas — sem executável nativo)

```bash
npm run dev
```

## Desenvolvimento com janela nativa Tauri

```bash
npm run tauri:dev
```

> Requer Rust + `cargo` instalados. O Tauri CLI compila o backend automaticamente.

## Build do executável

```bash
npm run tauri:build
```

O instalador (`.msi` / NSIS `.exe`) é gerado em `src-tauri/target/release/bundle/`.

---

## Estrutura do projeto

```
clio/
├── src/                    # Frontend React + TypeScript
│   ├── components/         # Componentes de UI
│   ├── services/           # Lógica de negócio (áudio, PDF, settings…)
│   ├── types/              # Tipos compartilhados
│   ├── imgs/               # Assets estáticos
│   ├── App.tsx             # Componente raiz
│   ├── main.tsx            # Ponto de entrada React
│   └── index.css           # Estilos globais (Tailwind)
├── src-tauri/              # Backend Rust (Tauri)
│   ├── src/
│   │   ├── main.rs         # Ponto de entrada do executável
│   │   └── commands.rs     # Comandos nativos (I/O de disco)
│   ├── icons/              # Ícones do aplicativo
│   ├── Cargo.toml          # Manifesto Rust
│   ├── build.rs            # Script de build Tauri
│   └── tauri.conf.json     # Configuração do Tauri
├── public/                 # Assets públicos (favicon, ícones)
├── index.html              # Ponto de entrada HTML
├── vite.config.ts          # Configuração do bundler
├── tsconfig.json           # Configuração TypeScript
└── package.json            # Dependências e scripts npm
```

---

## Fontes offline (opcional)

Para operação 100% offline (sem internet), substitua o `<link>` do Google Fonts no `index.html` por:

```bash
npm install @fontsource/plus-jakarta-sans @fontsource/jetbrains-mono
```

E em `src/index.css`:

```css
@import "@fontsource/plus-jakarta-sans/400.css";
@import "@fontsource/plus-jakarta-sans/500.css";
@import "@fontsource/plus-jakarta-sans/600.css";
@import "@fontsource/plus-jakarta-sans/700.css";
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/jetbrains-mono/500.css";
@import "@fontsource/jetbrains-mono/600.css";
```
