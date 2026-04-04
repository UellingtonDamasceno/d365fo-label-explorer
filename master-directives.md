# 🚀 Master Directives: D365FO Label Explorer

Este documento contém o compilado de todas as regras, decisões técnicas e estratégias de dados que o **agente-dev** deve seguir rigorosamente.

---

## 🏛️ 1. Visão do Projeto
O **D365FO Label Explorer** é um utilitário web estático para exploração e análise ultra-rápida de arquivos de label do Dynamics 365 F&O.

### Identidade e Atalhos:
- **Nome Oficial:** `D365FO Label Explorer`
- **Atalhos Globais:**
  - `Alt + F`: Focar na barra de pesquisa (selecionando o texto).
  - `Alt + S`: Painel de Busca Avançada (Filtros).
  - `Alt + P`: Configurações do Sistema (Exibição).
  - `Alt + R`: Re-scanear pasta atual.
  - `Alt + E`: Escolher/Trocar pasta raiz.
- **Navegação:** Setas `Up/Down` para navegar entre cards e `Espaço` para copiar/selecionar.
- **Tema:** Dark Mode (Padrão).
- **Idioma da UI:** Inglês (Default), com seletor para Português.

---

## 🛑 2. Regras Inegociáveis (CONSIDERAR SEMPRE)

### UX e Segurança
- **FLUIDEZ NO SELETOR:** O `showDirectoryPicker()` deve ser disparado imediatamente no evento de clique. Proibido processamento pesado antes do seletor abrir.
- **FEEDBACK DE SPLASH:** SEMPRE mostre mensagens granulares informando o que o sistema está fazendo durante o load inicial.
- **TIMESTAMP COMPLETO:** A informação de "Last Indexed" no Header **DEVE** exibir Data e Hora (ex: `03/04/2026 14:30`) para que o usuário saiba exatamente quão recentes são os dados.
- **TOGGLE SWITCH:** Use exclusivamente Toggle-Switches para opções booleanas.
- **UI RESPONSIVA:** O app NUNCA deve travar a Main Thread. Use Web Workers para parsing e indexação.

### Governança e Processo
- **CONSULTE ANTES DE AGIR:** Leia `knowledge/02-project-index.md` e `knowledge/03-error-log.md` antes de cada tarefa.
- **ATUALIZE AO FINAL:** Você DEVE atualizar o `knowledge/02-project-index.md` ao final de cada desenvolvimento.

---

## 🛠️ 3. Stack Tecnológica
- **Motor de Busca:** `FlexSearch`.
- **Persistência:** `IndexedDB` (armazenar DirectoryHandle, labels e metadados/configurações).
- **Zero Build:** O projeto deve rodar nativamente com HTML/JS/CSS (ES Modules). Utilize a extensão Live Server para desenvolvimento local devido ao CORS.

---

## 📊 4. Estratégia de Dados e Parsing
- **Discovery Path:** `PackagesLocalDirectory/Model/AxLabelFile/LabelResources/{Culture}/{File}`.
- **Parsing:** Suporte a multilinhas (ID=Texto + Metadados com ` ;`).
- **Prioridade de Processamento:** Idiomas `pt-BR`, `en-US` e `es` primeiro.

---
**IMPORTANTE:** SEMPRE priorize a fluidez. SEMPRE garanta que não haverá travamentos. SEMPRE dê feedback visual de carregamento.
---
