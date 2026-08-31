import { LEGAL_CONTACT_EMAIL, PRIVACY_UPDATED_ISO } from "../lib/legal";
import { InternalLink } from "../components/InternalLink";
import { LegalLayout } from "../components/LegalLayout";

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updatedIso={PRIVACY_UPDATED_ISO}>
      <section>
        <h2>Who we are</h2>
        <p>
          PixlPal is a photo editor that runs in your browser. Pixel processing happens on your
          device. This policy explains what information the PixlPal website (the “Service”)
          handles, what leaves your device, and what we store. Questions:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
        <p>
          This policy covers the website only. It does not cover a third-party model provider’s
          own practices, or an endpoint you configure under <em>Use your own API key</em>.
        </p>
      </section>

      <section>
        <h2>The short version</h2>
        <ul>
          <li>We do not ask you to create an account or give us an email address.</li>
          <li>
            Full-resolution photos are decoded, edited, segmented, and exported in your browser.
            We do not upload them to PixlPal for storage.
          </li>
          <li>
            Opening a photo, or sending a chat, can send a <strong>downscaled JPEG preview</strong>{" "}
            of the current look to an AI model so it can see the frame. That is the main time
            image pixels leave the device.
          </li>
          <li>
            We set one HttpOnly cookie so the hosted assistant can cap anonymous chats. Alongside
            it we store only an anonymous visitor id and the chat ids that visitor has opened.
          </li>
          <li>
            Optional API keys you type into Model settings stay in this browser’s{" "}
            <code>localStorage</code> and are sent to the endpoint you chose, not to PixlPal.
          </li>
        </ul>
      </section>

      <section>
        <h2>Photos and on-device processing</h2>
        <p>
          When you open a JPEG, PNG, or WebP file, the browser reads it into memory. A Rust engine
          compiled to WebAssembly applies your edit pipeline (exposure, grain, masks, and the rest)
          inside a Web Worker. Undo, redo, and export (JPEG or PNG download) also stay local.
          Subject segmentation uses Florence-2 in a dedicated worker on this device; the model
          sees pixels only in that worker.
        </p>
        <p>
          The preview sent to a model, when one is sent, is a recoded JPEG (longest side about 768
          pixels), not your original file. Embedded metadata such as EXIF is not copied into that
          JPEG.
        </p>
      </section>

      <section>
        <h2>When a preview leaves the device</h2>
        <h3>Automatic edit suggestions</h3>
        <p>
          After you open a photo, the editor asks the assistant for a few first-prompt suggestion
          chips tailored to that frame. That request includes the downscaled JPEG. On the hosted
          path it goes to our Cloudflare Worker at <code>/api/agent/suggest</code>, which forwards
          it to the configured model provider. Suggestion requests do not consume a chat quota
          slot. If the request fails, the panel falls back to generic chips and nothing is stored
          by us.
        </p>
        <h3>Chat with the assistant</h3>
        <p>
          Each message you send can include: your text; a fresh downscaled JPEG of the current
          look; a description of the active edit pipeline; tool schemas the model may call; and
          later, tool results. Tool results can include on-device measurements (brightness,
          clipping, color cast, and similar numbers) and mask identifiers — not full-resolution
          pixels and not the original file. Older turns keep text only so stale frames are not
          resent.
        </p>
        <p>
          The editing loop itself runs in your browser. The Worker’s job is to hold the product
          API key, enforce the anonymous chat cap, reject oversized hosted messages, cap
          generated tokens, time out hung completions, rate-limit abuse, and proxy one model
          completion per request. We do not persist chat transcripts, prompts, or images in our
          quota store.
        </p>
        <h3>Bring your own key</h3>
        <p>
          If you fill in Model settings, the browser talks to the OpenAI-compatible endpoint you
          named. Previews and messages go there directly. That provider’s privacy policy and
          retention rules apply. PixlPal never receives your key.
        </p>
      </section>

      <section>
        <h2>Cookies, local storage, and site data</h2>
        <h3>Visitor cookie</h3>
        <p>
          Cookie name: <code>pixelcam_vid</code>. It is HttpOnly, <code>SameSite=Lax</code>,{" "}
          <code>Secure</code> on HTTPS, and lasts one year. The value is a random anonymous id.
          We set it when the editor loads the hosted assistant quota, and when you use hosted
          suggest or chat. It is strictly necessary to enforce the free-chat limit and related
          rate limits without accounts. Clearing cookies (or using another browser) starts a
          fresh quota — that is the trade-off of no login.
        </p>
        <h3>Quota record</h3>
        <p>
          Cloudflare Workers KV stores a record keyed by that visitor id: the opaque chat ids
          already opened, plus a timestamp. No name, email, photo, or prompt. Records expire
          after one year, matching the cookie.
        </p>
        <h3>Model settings</h3>
        <p>
          Key <code>pixelcam.agent.settings</code> in <code>localStorage</code> may hold the
          endpoint URL, model name, and API key you entered. It never leaves this browser except
          when the browser sends the key to your chosen endpoint.
        </p>
        <h3>On-device model cache</h3>
        <p>
          The first time you run subject segmentation, the browser may download Florence-2
          weights from Hugging Face (or from this origin if you have fetched them locally) and
          cache them with the Cache API or similar browser storage. Those downloads are model
          files, not your photos. Hugging Face may see a network request from your IP.
        </p>
      </section>

      <section>
        <h2>Infrastructure logs and rate limits</h2>
        <p>
          The Service is hosted on Cloudflare. Like most HTTPS hosts, Cloudflare and our Worker
          may process standard request metadata: IP address, date and time, URL, user agent, and
          coarse location derived from IP. We use this to operate the site, debug failures, and
          apply per-visitor rate limits on assistant and suggestion endpoints. Cloudflare
          observability may retain operational logs under Cloudflare’s own terms. We do not use
          a separate advertising or product-analytics SDK.
        </p>
      </section>

      <section>
        <h2>What we do not collect</h2>
        <ul>
          <li>Accounts, passwords, or payment details.</li>
          <li>A name, email, or profile, unless you choose to email us.</li>
          <li>Full-resolution photo archives on our servers.</li>
          <li>Cross-site advertising identifiers or marketing pixels.</li>
        </ul>
      </section>

      <section>
        <h2>How we use information</h2>
        <ul>
          <li>To run the editor and the hosted assistant.</li>
          <li>To cap anonymous chats and slow down abuse.</li>
          <li>To generate photo-specific suggestion chips when you open a photo.</li>
          <li>To respond if you email us.</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </section>

      <section>
        <h2>Who else sees information</h2>
        <ul>
          <li>
            <strong>Cloudflare</strong> — hosting, CDN, Workers, KV, rate limiting.
          </li>
          <li>
            <strong>The hosted model provider</strong> — by default OpenAI, via{" "}
            <code>https://api.openai.com</code>. They receive suggestion and chat payloads
            described above, including downscaled previews. Their privacy policy governs what
            they retain and whether they use API data for training. We do not train a PixlPal
            generative model on your photos (we do not operate one).
          </li>
          <li>
            <strong>Hugging Face</strong> — model-weight downloads for on-device segmentation
            when local weights are not shipped.
          </li>
          <li>
            <strong>A provider you configure</strong> — if you use your own API key.
          </li>
        </ul>
        <p>
          We may also disclose information if required by law, or to protect the Service and
          other users from abuse.
        </p>
      </section>

      <section>
        <h2>Retention</h2>
        <ul>
          <li>Visitor cookie: up to one year, or until you clear it.</li>
          <li>Quota KV record: up to one year from last write.</li>
          <li>
            Chat and suggestion bodies: not stored in KV. They exist in transit through the
            Worker and then with the model provider for as long as that provider keeps them.
          </li>
          <li>
            Photos, masks, and chat UI state in the tab: until you close the tab, choose New
            photo, or clear the page.
          </li>
          <li>
            <code>localStorage</code> settings and cached weights: until you clear site data for
            this origin.
          </li>
        </ul>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li>
            Edit with sliders only. Do not open a photo if you do not want a suggestion request;
            do not send a chat if you do not want a preview in that turn.
          </li>
          <li>
            Use your own API key so hosted PixlPal never proxies the preview. You still send it
            to the endpoint you chose.
          </li>
          <li>Clear cookies and site data to drop the visitor id, quota, key, and caches.</li>
          <li>
            Skip subject segmentation if you do not want the browser to fetch Hugging Face
            weights.
          </li>
        </ul>
      </section>

      <section>
        <h2>International processing</h2>
        <p>
          Cloudflare and the default model provider operate in the United States and other
          countries. If you use the Service from the EEA, UK, or Switzerland, your information
          (including previews sent to the hosted assistant) may be processed in those countries.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          The Service is not directed at children under 13, and we do not knowingly collect
          personal information from them. If you believe a child has submitted information to
          us, email <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> and we
          will delete what we hold (typically only an anonymous quota record).
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Depending on where you live, you may have rights to access, correct, delete, or
          export personal information, to object or restrict certain processing, and to appeal a
          refusal. Because we do not run accounts, the practical way to delete the visitor cookie
          and local settings is to clear site data. To ask about a quota record, email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> from a request that
          explains the issue — we cannot look up a person by name. California residents: we do
          not sell or share personal information for cross-context behavioral advertising.
        </p>
        <p>
          EEA/UK users: our legal bases are performing the Service you request (the editor and
          assistant), legitimate interests in running a limited anonymous quota and preventing
          abuse, and consent where a rule requires it for optional features.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We will update the “Last updated” date at the top of this page when the policy
          changes. Continued use after a change means you accept the revised policy. Material
          changes to how previews are sent will be described here.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Email <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>. Related:{" "}
          <InternalLink href="/terms">Terms of Service</InternalLink>.
        </p>
      </section>
    </LegalLayout>
  );
}
