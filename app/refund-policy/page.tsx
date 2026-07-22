export default function RefundPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-300">
      <h1 className="text-3xl font-bold text-white mb-6">Refund Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Last updated: July 2026</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold text-white">1. Free Trial</h2>
        <p>
          Every new account receives a 14-day free trial with full access to RIVANT.
          No payment is taken during this period, so there is nothing to refund — you
          can evaluate the product risk-free before subscribing.
        </p>

        <h2 className="text-lg font-semibold text-white">2. First Subscription Payment</h2>
        <p>
          If you are not satisfied with RIVANT after your first paid subscription
          payment, you may request a full refund within 7 days of that payment by
          contacting us through our contact form. This applies once per customer, to
          the first payment only.
        </p>

        <h2 className="text-lg font-semibold text-white">3. Renewals & Subsequent Payments</h2>
        <p>
          Recurring monthly payments after your first billing cycle are non-refundable.
          You can cancel your subscription at any time to stop future renewals — your
          access will remain active until the end of the period you already paid for.
        </p>

        <h2 className="text-lg font-semibold text-white">4. Plan Changes</h2>
        <p>
          If you upgrade your plan, the new price applies from your next billing cycle.
          Upgrades and downgrades do not generate a refund for the difference in the
          current period.
        </p>

        <h2 className="text-lg font-semibold text-white">5. How to Request a Refund</h2>
        <p>
          Contact us through the contact form on our website with your account email
          and the reason for your request. Eligible refunds (see section 2) are
          processed via Paddle, our payment provider, within 5-10 business days.
        </p>

        <h2 className="text-lg font-semibold text-white">6. Billing Disputes</h2>
        <p>
          If you believe you were charged in error, please contact us before initiating
          a chargeback with your bank — we're able to resolve most billing issues
          directly and faster this way.
        </p>
      </div>
    </div>
  );
}