import { LEGAL_CONTACT_EMAIL, TERMS_UPDATED_ISO } from "../lib/legal";
import { InternalLink } from "../components/InternalLink";
import { LegalLayout } from "../components/LegalLayout";

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updatedIso={TERMS_UPDATED_ISO}>
      <section>
        <h2>Agreement</h2>
        <p>
          These Terms of Service (“Terms”) govern your use of the PixlPal website (the
          “Service”), a browser-based photo editor with an optional AI assistant. By using the
          Service you agree to these Terms and to the{" "}
          <InternalLink href="/privacy">Privacy Policy</InternalLink>. If you do not agree, do
          not use the Service.
        </p>
        <p>
          Questions: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section>
        <h2>The Service</h2>
        <p>
          PixlPal applies declarative pixel operations (tone, color, grain, optical effects,
          optional masks) with a local engine. The assistant does not generate or paint a new
          photograph. It operates the same controls you can drag.
        </p>
        <p>
          The hosted assistant is a limited, free, anonymous convenience. It is capped per
          browser (currently a small number of chats), each hosted message is length-limited,
          each model completion is token-capped, rate-limited, and provided with no uptime or
          quality commitment. We may change the model, the limits, or withdraw the hosted path
          at any time. Continuing an existing chat does not use another slot; starting a new
          chat does. Clearing cookies resets the chat cap.
        </p>
        <p>
          Optional “Use your own API key” talks to an endpoint you configure. You are
          responsible for that account, its fees, and its acceptable-use rules.
        </p>
      </section>

      <section>
        <h2>No accounts</h2>
        <p>
          The Service does not offer user accounts. Hosted quota is tied to a cookie, not to a
          person. We do not promise that a quota will follow you across devices, and we do not
          owe you unused chats.
        </p>
      </section>

      <section>
        <h2>Your photos and content</h2>
        <p>
          You retain whatever rights you already have in photos you open and in files you
          export. Opening a photo does not transfer ownership to us.
        </p>
        <p>You represent that:</p>
        <ul>
          <li>you have the rights needed to process the photo in this editor;</li>
          <li>
            if you use suggestions or chat, you have the rights needed to send a downscaled
            preview and related text to the model provider (hosted or your own key);
          </li>
          <li>
            the photo and your prompts will not violate these Terms or applicable law.
          </li>
        </ul>
        <p>
          You grant us a limited, revocable license to transmit that preview and the associated
          chat or suggestion payload through our Worker to the hosted model provider, solely to
          provide those features. We do not claim a license to keep or reuse your photos after
          the request finishes. The Service does not store your full-resolution files on our
          servers; if you close the tab without exporting, we cannot recover the edit.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You may not:</p>
        <ul>
          <li>
            upload or send content that is illegal, including child sexual abuse material, or
            non-consensual intimate imagery;
          </li>
          <li>
            use the assistant to probe, harass, or invade someone’s privacy beyond what the
            editor’s tools are for;
          </li>
          <li>
            abuse, overload, or circumvent the hosted API, rate limits, chat cap, message
            length limit, or output-token cap (including treating{" "}
            <code>/api/agent/suggest</code> as a general-purpose model proxy);
          </li>
          <li>probe, scan, or disrupt the Service except through good-faith security research disclosed to us;</li>
          <li>
            reverse engineer the Service in order to steal the product API key or to evade
            quota, except as allowed by mandatory law;
          </li>
          <li>misrepresent the Service as generating photographs that were never taken.</li>
        </ul>
        <p>
          When you use the hosted assistant, the model provider’s usage policies (including
          OpenAI’s, when that is the configured provider) also apply to the prompts and previews
          you send.
        </p>
      </section>

      <section>
        <h2>AI and results</h2>
        <p>
          Suggestion chips and chat replies are machine-generated. They can be wrong, irrelevant,
          or a poor match for the photo. Slider values the assistant sets are still just edits
          you can undo. We do not warrant that an edit will be suitable for professional,
          archival, medical, legal, or forensic use.
        </p>
        <p>
          Using suggestions or chat means a downscaled preview leaves the device, as described
          in the Privacy Policy. If that is unacceptable for a given photo, use the sliders
          only.
        </p>
      </section>

      <section>
        <h2>Intellectual property</h2>
        <p>
          PixlPal, the editor UI, the pipeline format, and the accompanying software are owned
          by us and our licensors. We grant you a personal, non-exclusive, non-transferable
          license to use the Service as provided, for its intended purpose. You may not copy,
          scrape, or republish the Service except as the interface itself allows (for example
          exporting your edited photo).
        </p>
      </section>

      <section>
        <h2>Third-party services</h2>
        <p>
          The Service depends on Cloudflare for hosting, and may call OpenAI (hosted assistant),
          Hugging Face (on-device segmentation weights), and any OpenAI-compatible endpoint you
          configure. Those services are not under our control. Their terms and privacy policies
          apply to their processing. We are not responsible for outages or policy changes on
          their side.
        </p>
      </section>

      <section>
        <h2>Disclaimer of warranties</h2>
        <p>
          The Service is provided “as is” and “as available,” without warranties of any kind,
          whether express, implied, or statutory, including merchantability, fitness for a
          particular purpose, title, and non-infringement. We do not warrant that the editor or
          assistant will be uninterrupted, error-free, or free of harmful components.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, PixlPal and its operators will not be liable
          for any indirect, incidental, special, consequential, or punitive damages, or for any
          loss of photos, data, profits, or goodwill, arising from your use of the Service,
          even if advised of the possibility. Our total liability for any claim relating to the
          Service will not exceed the greater of (a) the amount you paid us for the Service in
          the three months before the claim (currently zero, because the site is free) or (b)
          twenty-five U.S. dollars.
        </p>
        <p>
          Some places do not allow certain limitations. In those places, our liability is
          limited to the fullest extent permitted. Nothing in these Terms limits liability that
          cannot be limited, including for fraud or for death or personal injury caused by
          negligence where such a limit is forbidden.
        </p>
      </section>

      <section>
        <h2>Indemnity</h2>
        <p>
          You will defend and indemnify PixlPal and its operators against claims, damages, and
          reasonable legal fees arising from your photos, prompts, or other content, or from
          your misuse of the Service, except to the extent we caused the harm.
        </p>
      </section>

      <section>
        <h2>Suspension</h2>
        <p>
          We may suspend or block access (including by quota, rate limit, or taking the Worker
          offline) if we believe you are abusing the Service or these Terms. Because there are
          no accounts, “termination” on our side may simply mean the hosted endpoints stop
          responding.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We may update these Terms by posting a new version with a new “Last updated” date.
          Continued use after that date constitutes acceptance. If you do not agree, stop using
          the Service.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>
          These Terms are governed by applicable law, without regard to conflict-of-law rules
          that would choose a different law. If you are a consumer in the European Economic
          Area or the United Kingdom, nothing here limits the mandatory protections of your
          home country. Courts in a jurisdiction that has a substantial connection to the
          dispute may hear it, subject to those consumer rules.
        </p>
      </section>

      <section>
        <h2>General</h2>
        <p>
          These Terms and the Privacy Policy are the entire agreement between you and us for
          the website. If a provision is unenforceable, the rest remains in effect. Failure to
          enforce a provision is not a waiver. You may not assign these Terms without our
          consent; we may assign them in connection with a reorganization of the project.
        </p>
        <p>
          Contact: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalLayout>
  );
}
