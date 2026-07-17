# Love IT DMC · Presenta — Setup Guide

App web per generare presentazioni da PDF. Accessibile da tutti, modificabile solo da Marco.

---

## Cosa serve (tutto gratuito)

| Cosa | Dove | Note |
|------|------|------|
| Account GitHub | github.com | Per tenere i file e fare aggiornamenti |
| Account Vercel | vercel.com | Per hostare l'app online |
| API Key Anthropic | console.anthropic.com | Per l'AI — ~€0.03 per presentazione |
| API Key Unsplash (opzionale) | unsplash.com/developers | Per le foto nelle slide · 50 req/ora gratis |

---

## Setup — passo per passo

### 1. Crea il repository su GitHub

1. Vai su **github.com** → clicca **New repository**
2. Nome: `loveit-presenta` (privato o pubblico, a scelta)
3. Trascina l'intera cartella `loveit-presenta-app/` nel repository (o usa GitHub Desktop)
4. Fai commit → Push

### 2. Collega Vercel a GitHub

1. Vai su **vercel.com** → Sign up con il tuo account GitHub
2. Clicca **Add New Project**
3. Importa il repository `loveit-presenta`
4. Vercel rileva automaticamente la configurazione — clicca **Deploy**

### 3. Aggiungi le variabili d'ambiente su Vercel

Nel progetto Vercel → **Settings → Environment Variables**, aggiungi:

| Nome variabile | Valore | Dove ottenerla |
|----------------|--------|----------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | console.anthropic.com → API Keys |
| `UNSPLASH_ACCESS_KEY` | `...` | unsplash.com/oauth/applications (opzionale) |

Dopo aver aggiunto le variabili → clicca **Redeploy**.

### 4. Ottieni la API Key Anthropic

1. Vai su **console.anthropic.com**
2. Registrati (oppure accedi se hai già un account)
3. Vai su **API Keys** → **Create Key**
4. Copia la chiave e incollala in Vercel come `ANTHROPIC_API_KEY`
5. Aggiungi un metodo di pagamento su Anthropic (pay-per-use)
   - Budget stimato: ~€0.03 per presentazione, ~€1-3/mese per uso normale

### 5. (Opzionale) Ottieni la API Key Unsplash

Senza questa chiave l'app usa foto di default incorporate.
Con la chiave: le foto vengono cercate per ogni attività (risultato molto migliore).

1. Vai su **unsplash.com/developers** → **Your apps** → **New Application**
2. Copia l'**Access Key** e incollala in Vercel come `UNSPLASH_ACCESS_KEY`

### 6. Condividi l'URL con il team

Vercel assegna un URL tipo `loveit-presenta.vercel.app`.
Puoi anche configurare un dominio personalizzato tipo `presenta.loveit-dmc.com`.

Condividi quell'URL con tutto il team — chiunque può usarlo senza installare nulla.

---

## Come aggiornare il template

Quando vuoi aggiornare il template di presentazione (nuovo layout, nuovi stili, ecc.):

1. Modifica `template/loveit_template.html` nel repository GitHub
2. Fai commit → Push
3. Vercel rideploya automaticamente in ~1 minuto
4. Tutti gli utenti vedono la versione aggiornata al prossimo utilizzo

---

## Come funziona l'app

```
Utente carica PDF
      ↓
App invia il PDF (base64) all'API /api/generate
      ↓
La funzione chiama Claude claude-sonnet-4-6 con il PDF
      ↓
Claude estrae: cliente, date, pax, attività, ecc.
      ↓
La funzione cerca le foto su Unsplash per ogni attività
      ↓
I dati vengono iniettati nel template HTML
      ↓
L'utente scarica il file .html e lo apre nel browser
```

---

## Struttura file

```
loveit-presenta-app/
├── public/
│   └── index.html           ← interfaccia web (frontend)
├── api/
│   └── generate.js          ← funzione serverless (backend)
├── template/
│   └── loveit_template.html ← template presentazione
├── package.json
├── vercel.json
└── SETUP.md                 ← questo file
```

---

## Aggiornare le istruzioni AI

Le istruzioni per l'AI si trovano nel file `api/generate.js`, nella costante `SYSTEM_PROMPT` in cima al file.
Puoi modificarla direttamente su GitHub → salva → Vercel rideploya automaticamente.

---

## Troubleshooting

**"Template file not found"** → Verifica che `template/loveit_template.html` sia nel repository.

**"Claude API error"** → Verifica che `ANTHROPIC_API_KEY` sia impostata correttamente in Vercel e che l'account Anthropic abbia credito.

**"Claude returned invalid JSON"** → Prova a rigenerare. A volte Claude aggiunge testo extra attorno al JSON — il sistema prova a ripulirlo ma in rari casi fallisce.

**Foto di bassa qualità** → Aggiungi `UNSPLASH_ACCESS_KEY` per ottenere foto specifiche per ogni attività.
