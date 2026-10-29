import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DISCLAIMER } from '../types';

// Public pages: readable without signing in, linked from the footer and the sign-in page.

export const CONTACT_EMAIL = 'mokshadpoojary9@gmail.com';
const UPDATED = '29 October 2026';

function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <article className="card mx-auto mt-6 max-w-3xl space-y-6 p-6 sm:p-8">
      <header className="space-y-2">
        <p className="eyebrow">EvidenceLoop</p>
        <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
        <p className="text-xs text-fg-faint">Last updated {UPDATED}</p>
        <p className="text-sm text-fg-muted">{intro}</p>
      </header>
      <div className="space-y-6 text-sm leading-relaxed text-fg-muted [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </article>
  );
}

function Contact() {
  return (
    <section>
      <h2>Contact</h2>
      <p>
        Questions, or a request to see or delete your data:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-accent-fg underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" intro="What EvidenceLoop stores, why, and who processes it.">
      <section>
        <h2>What we store</h2>
        <ul>
          <li>
            <strong className="text-fg">Your account:</strong> your email address, and, if you sign in with Google, the
            name and profile picture Google shares. Passwords are handled by Supabase Auth; we never see them.
          </li>
          <li>
            <strong className="text-fg">Work orders:</strong> titles, descriptions, requirements and review decisions.
          </li>
          <li>
            <strong className="text-fg">Uploaded evidence:</strong> the photos, videos and documents you add, kept in
            private storage and shown only through short-lived links.
          </li>
          <li>
            <strong className="text-fg">AI results:</strong> the observations, reasoning, statuses and evidence requests
            produced for each requirement, and the audit trail of every run.
          </li>
        </ul>
      </section>
      <section>
        <h2>How evidence is analysed</h2>
        <p>
          To check whether evidence proves a requirement, the evidence and the requirement text are sent to{' '}
          <strong className="text-fg">NVIDIA Nemotron via Nebius Token Factory</strong>. No other AI provider receives
          your data.
        </p>
      </section>
      <section>
        <h2>Where it is kept</h2>
        <p>
          Accounts, data and files are stored with Supabase. The application runs on Vercel (website) and Render (API).
          Access to work orders is limited by account and role, and enforced by the database.
        </p>
      </section>
      <section>
        <h2>What we do not do</h2>
        <ul>
          <li>We do not sell your data or share it for advertising.</li>
          <li>We do not use tracking or advertising cookies. Sign-in keeps a session in your browser.</li>
        </ul>
      </section>
      <Contact />
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of Use" intro="The rules for using EvidenceLoop.">
      <section>
        <h2>What EvidenceLoop is</h2>
        <p>
          EvidenceLoop helps check whether evidence proves that work requirements were completed. Its results are
          decision support. {DISCLAIMER}
        </p>
      </section>
      <section>
        <h2>Your account and content</h2>
        <ul>
          <li>Keep your sign-in details to yourself; you are responsible for activity on your account.</li>
          <li>Upload only evidence you have the right to share. It stays yours.</li>
          <li>
            Uploaded evidence is analysed by NVIDIA Nemotron via Nebius Token Factory, as described in the{' '}
            <Link to="/privacy" className="font-semibold text-accent-fg underline">Privacy Policy</Link>.
          </li>
        </ul>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>Do not upload unlawful content, try to access other people&apos;s data, or disrupt the service.</p>
      </section>
      <section>
        <h2>No guarantee</h2>
        <p>
          EvidenceLoop is provided as is. AI analysis can be wrong; a status of proven is not a certification, and
          physical safety is never guaranteed. We may change or stop the service and will update these terms here.
        </p>
      </section>
      <Contact />
    </LegalPage>
  );
}
