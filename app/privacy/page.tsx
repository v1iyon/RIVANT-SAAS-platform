export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-300">
      <h1 className="text-3xl font-bold text-white mb-6">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: July 2026</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <p>
          This Privacy Policy explains how RIVANT collects, uses, and protects your
          information when you use our service.
        </p>

        <h2 className="text-lg font-semibold text-white">1. Information We Collect</h2>
        <p>
          - Account information: email address, name, phone number (optional).<br />
          - Business data: revenue, expenses, and other metrics you connect via Stripe
          or upload via CSV.<br />
          - Usage data: how you interact with the dashboard, for the purpose of
          improving the product.
        </p>

        <h2 className="text-lg font-semibold text-white">2. How We Use Your Data</h2>
        <p>
          We use your data to provide the analytics, forecasts, and alerts you see in
          your dashboard, to process payments (via Paddle), and to communicate with
          you about your account.
        </p>

        <h2 className="text-lg font-semibold text-white">3. Data Sharing</h2>
        <p>
          We do not sell your data. We share data only with service providers necessary
          to operate RIVANT, including Supabase (database hosting), Paddle (payment
          processing), and Stripe (if you connect your own Stripe account for read-only
          data access).
        </p>

        <h2 className="text-lg font-semibold text-white">4. Data Storage & Security</h2>
        <p>
          Your data is stored securely using Supabase infrastructure. We take
          reasonable technical measures to protect your information from unauthorized
          access.
        </p>

        <h2 className="text-lg font-semibold text-white">5. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active. You can request
          deletion of your account and all associated data at any time from Settings →
          Danger Zone, or by contacting us.
        </p>

        <h2 className="text-lg font-semibold text-white">6. Your Rights</h2>
        <p>
          You may access, correct, export, or delete your personal data at any time.
          Contact us if you need help exercising these rights.
        </p>

        <h2 className="text-lg font-semibold text-white">7. Cookies</h2>
        <p>
          We use essential cookies to keep you logged in and remember your language
          preference. See our Cookie Policy for details.
        </p>

        <h2 className="text-lg font-semibold text-white">8. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify users of
          significant changes.
        </p>

        <h2 className="text-lg font-semibold text-white">9. Contact</h2>
        <p>
          Questions about this policy can be sent through our contact form on the
          website.
        </p>
      </div>
    </div>
  );
}