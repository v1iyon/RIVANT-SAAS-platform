export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-300">
      <h1 className="text-3xl font-bold text-white mb-6">Terms of Service</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: July 2026</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <p>
          These Terms of Service ("Terms") govern your access to and use of RIVANT
          ("RIVANT", "we", "us", "our"), a business analytics dashboard available at
          rivant-os.vercel.app. By creating an account or using RIVANT, you agree to
          these Terms.
        </p>

        <h2 className="text-lg font-semibold text-white">1. The Service</h2>
        <p>
          RIVANT provides business analytics, forecasting, and alerting tools based on
          data you connect (including but not limited to Stripe and CSV uploads).
          Features available depend on your subscription plan (Starter, Growth, Scale).
        </p>

        <h2 className="text-lg font-semibold text-white">2. Accounts</h2>
        <p>
          You must provide accurate information when creating an account and are
          responsible for keeping your login credentials secure. You must be at least
          18 years old to use RIVANT.
        </p>

        <h2 className="text-lg font-semibold text-white">3. Subscriptions & Billing</h2>
        <p>
          Paid plans are billed monthly in advance. Payments are processed by Paddle.com
          Market Limited, our authorized reseller. By subscribing, you authorize
          recurring charges until you cancel. See our Refund Policy for details on
          refunds.
        </p>

        <h2 className="text-lg font-semibold text-white">4. Free Trial</h2>
        <p>
          New accounts may receive a 14-day free trial with full feature access. No
          payment is required during the trial. At the end of the trial, continued
          access requires an active paid subscription.
        </p>

        <h2 className="text-lg font-semibold text-white">5. Acceptable Use</h2>
        <p>
          You agree not to misuse RIVANT, attempt unauthorized access to our systems,
          upload unlawful content, or use the service to violate any applicable law.
        </p>

        <h2 className="text-lg font-semibold text-white">6. Data & Third-Party Integrations</h2>
        <p>
          When you connect third-party services (e.g. Stripe) or upload CSV files, you
          confirm you have the right to share this data with us. We process this data
          solely to provide analytics to you. See our Privacy Policy for details.
        </p>

        <h2 className="text-lg font-semibold text-white">7. Termination</h2>
        <p>
          You may cancel your subscription at any time from your account settings.
          We may suspend or terminate accounts that violate these Terms.
        </p>

        <h2 className="text-lg font-semibold text-white">8. Disclaimer & Limitation of Liability</h2>
        <p>
          RIVANT is provided "as is". Forecasts and AI-generated insights are estimates
          based on available data and are not guaranteed to be accurate. RIVANT is not
          liable for business decisions made based on this data.
        </p>

        <h2 className="text-lg font-semibold text-white">9. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of RIVANT after
          changes constitutes acceptance of the updated Terms.
        </p>

        <h2 className="text-lg font-semibold text-white">10. Contact</h2>
        <p>
          Questions about these Terms can be sent through our contact form on the
          website.
        </p>
      </div>
    </div>
  );
}