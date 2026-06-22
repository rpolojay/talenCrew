# TalenCrew — Google AI Studio Setup Guide

## What's in This Package

```
talencrew-aistudio/
├── README.md          ← You are here
├── index.html         ← Main website (bilingual EN/ES)
├── firebase.json      ← Firebase hosting config
├── .firebaserc        ← Firebase project config
└── prompts.md         ← AI prompts to customize your site
```

---

## Step-by-Step: Getting Live on talencrew.com

### Step 1 — Open Google AI Studio
Go to: https://aistudio.google.com
Sign in with your Google account.

### Step 2 — Create a New Project
Click "New Project" → Select "Web App" → Name it "TalenCrew"

### Step 3 — Upload Your Files
Upload all files from this folder into the project root.
Your main site is in `index.html`.

### Step 4 — Connect Firebase
In Google AI Studio, click "Connect Firebase" →
Create a new Firebase project → Name it "talencrew"

### Step 5 — Deploy
Click "Deploy" → Firebase Hosting →
Your site goes live at: https://talencrew.web.app

### Step 6 — Connect Your Domain (talencrew.com)
1. Go to console.firebase.google.com
2. Click Hosting → Add Custom Domain
3. Type: talencrew.com
4. Firebase gives you DNS records
5. Go to Namecheap → Manage talencrew.com → Advanced DNS
6. Add the records Firebase gives you
7. Wait 24-48 hours → talencrew.com is live ✅

---

## Customizing With AI Chat

Inside Google AI Studio, use the chat to modify your site.
See `prompts.md` for ready-to-use prompts.

---

## Contact & Support
- Employer inquiries: hire@talencrew.com
- Candidate inquiries: hello@talencrew.com
- Powered by Selective Crew — selectivecrew.com
