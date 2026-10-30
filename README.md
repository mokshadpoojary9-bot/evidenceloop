EvidenceLoop
Prove the work. Don't just trust the photo.
EvidenceLoop is an AI agent that checks whether photos, videos and documents actually prove that real-world work was done. It is powered by NVIDIA Nemotron running on Nebius Token Factory.
Live demo: https://evidenceloop-phi.vercel.app
Hackathon: Nebius × NVIDIA Global AI Hackathon, Best Apps and Agents track
License: MIT
![EvidenceLoop landing page](docs/screenshots/landing.png)
---
Table of Contents
Problem
Solution
How It Works
Features
How NVIDIA Nemotron Is Used
Guardrails
User Roles
Tech Stack
Screenshots
Getting Started
Try It (for Judges)
Security
Roadmap
Author
---
1. Problem
Maintenance and safety jobs, such as replacing an emergency light, are usually approved from a single photo that nobody really checks.
A photo does not prove the right part was installed, the wiring is done, or that it works.
Image classifiers only say what is in a picture, not whether the job is complete.
When proof is missing, workers get vague requests like "send more photos".
There is no record of why a job was accepted.
---
2. Solution
EvidenceLoop checks every requirement of a job against the evidence and asks for exactly what is missing.
Example: Replace the emergency light in Room 204
The job has 6 requirements: correct unit, correct location, securely mounted, electrical connection, indicator working, and functional test.
The technician uploads before and after photos, a close-up and the SOP manual.
NVIDIA Nemotron checks every file and marks each requirement as Proven, Not proven, Uncertain or Contradicted.
Where proof is missing, it asks for one specific item: "Upload a 5–10 second video showing the emergency light functional test."
The technician uploads the video. Only the affected requirements are checked again.
When everything is proven, the job is Verified.
A separate reviewer approves it, and a PDF report is created.
---
3. How It Works
Step	What happens
1. Plan	A checklist is created from a template or drafted from an SOP document
2. Analyze	Nemotron reads the photos, PDF text and video frames together
3. Guard	Our code checks every AI answer and can only make it more cautious
4. Request	Missing proof becomes one clear, specific request
5. Re-analyze	New evidence re-checks only the requirements it affects
6. Approve	A reviewer signs off, and every step is saved in the audit trail
---
4. Features
Feature	Description
AI verification loop	Plans, checks, requests missing evidence and re-checks automatically
Multimodal evidence	Supports photos, PDF documents and videos
Camera capture	Take photos or record videos directly in the app
Verity assistant	An AI helper that explains results, for example "Why is this not verified?"
Technician and Reviewer roles	Separate screens; technicians cannot approve their own work
Google sign-in	Secure login with Google or a verified email
SOP to requirements	Nemotron reads a manual and drafts the checklist
Live 3D graph	Shows each requirement changing colour as results arrive
Audit trail and PDF report	Every action is recorded and can be exported
---
5. How NVIDIA Nemotron Is Used
Model	Purpose	Why this model
Nemotron 3.5 Super VL (`nvidia/Nemotron-3.5-Super-VL`)	Checks the evidence and drafts requirements from SOPs	Understands images and text, reasons carefully and returns structured results
Nemotron 3 Nano (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`)	Powers the Verity assistant	Fast and low-cost for quick answers
What Nemotron receives: the job, all its requirements, the photos, the text from PDF documents, and up to 8 timestamped frames from each video.
What Nemotron returns for each requirement: a status, what it observed (with the file it came from), its reasoning, a confidence level, and the exact evidence still needed.
How Nebius Token Factory helped
The API is OpenAI-compatible, so integration was quick and simple.
One vision model replaced separate tools for reading text and describing images.
Switching between the large and small model is a single setting.
Hosted inference means no GPUs to set up or manage.
---
6. Guardrails
The AI suggests a result, and our code makes the final decision.
A requirement is only Proven if the AI directly observed it in a real uploaded file.
References to files that do not exist are removed.
Missing or invalid AI answers are treated as Not proven.
When proof is not enough, the app clearly says: "I cannot verify this requirement from the available evidence."
A job is Verified only when every mandatory requirement is proven.
The Verity assistant can explain results but can never change them.
> EvidenceLoop supports inspectors. It does not replace official certification or guarantee safety.
---
7. User Roles
Action	Technician	Reviewer
Create jobs and upload evidence	Yes	No
Run AI verification	Yes	No
Submit a job for review	Yes	No
Approve, reject or request more evidence	No	Yes
View the audit log of all jobs	No	Yes
Every new account starts as a Technician. A Reviewer is assigned in the database by an administrator.
---
8. Tech Stack
Area	Technology
AI	NVIDIA Nemotron on Nebius Token Factory
Frontend	React, Vite, TypeScript, Tailwind CSS, React Three Fiber
Backend	Node.js, Express, TypeScript
File processing	PDF text extraction and video frame sampling (ffmpeg)
Database and login	Supabase (database, file storage, Google sign-in)
Hosting	Vercel (frontend) and Render (backend)
---
9. Screenshots
Dashboard
![Dashboard](docs/screenshots/dashboard.png)
Work order with the live 3D verification graph
![Work order](docs/screenshots/work-order.png)
Evidence viewer
![Evidence viewer](docs/screenshots/evidence-viewer.png)
---
10. Getting Started
Requirements: Node.js 20.12 or newer
Steps
Clone the repository: `git clone https://github.com/mokshadpoojary9-bot/evidenceloop.git`
Open the folder: `cd evidenceloop`
Install packages: `npm install`
Copy `backend/.env.example` to `backend/.env` and add your Nebius API key and model name.
Load the demo data: `npm run seed:demo`
Start the app: `npm run dev`
Open http://localhost:5173
Backend settings (`backend/.env`)
Setting	Purpose
`NEBIUS_API_KEY`	Your Nebius Token Factory key (keep secret)
`NEBIUS_BASE_URL`	`https://api.tokenfactory.nebius.com/v1`
`NEBIUS_MODEL`	`nvidia/Nemotron-3.5-Super-VL`
`NEBIUS_ASSISTANT_MODEL`	`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`
`SUPABASE_URL` and `SUPABASE_SECRET_KEY`	Database connection (optional for local use)
`CORS_ORIGIN`	The website address allowed to use the API
Frontend settings (`frontend/.env.local`)
Setting	Purpose
`VITE_API_BASE_URL`	Backend address (leave empty for local use)
`VITE_SUPABASE_URL`	Supabase project address
`VITE_SUPABASE_PUBLISHABLE_KEY`	Supabase public key
A full demo walkthrough is in DEMO.md.
---
11. Try It (for Judges)
Open https://evidenceloop-phi.vercel.app. The first load can take up to a minute while the server starts.
Sign in with Google.
Click New work order, choose Emergency light replacement, and click Create.
Upload the sample files from the `demo/room-204` folder: before photo, after photo, close-up and SOP.
Click Run verification.
Upload `functional-test.mp4` when the video is requested.
Click Ask Verity and ask "Why is this work order verified?"
Click Submit for review, then Export report.
---
12. Security
API keys are stored only on the server, never in the browser.
Each user can only see their own data, enforced by the database.
Uploaded files are stored privately and protected with temporary links.
Every upload is fingerprinted (SHA-256) so it cannot be swapped later.
---
13. Roadmap
Audio transcription for spoken test confirmations
Reading scanned documents (OCR)
Guided photo capture on mobile
Team workspaces
Integration with maintenance ticketing systems
---
14. Author
Moksha Poojary
GitHub: https://github.com/mokshadpoojary9-bot
Built for the Nebius × NVIDIA Global AI Hackathon, powered by NVIDIA Nemotron on Nebius Token Factory.
Licensed under the MIT License.
