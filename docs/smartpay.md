This is a comprehensive, structured technical brief of the SmartPay Tajikistan API (v2), optimized for an AI agent to perform a system integration.

SmartPay API Integration Technical Brief (v2)
1. Environments & Base URLs
Sandbox (Testing): https://sandbox.smartpay.tj/api/merchant

Production: https://ecomm.smartpay.tj/api/merchant

Response Format: Always application/json.

2. Authentication
All requests must include the API key in the headers:

Header: x-app-token: YOUR_API_KEY

Error Codes: 401 (Missing/Invalid Token), 403 (Not Authenticated/Feature Disabled).

3. Core Payment Flow (Standard Invoice)
This is the standard flow: Create Invoice → Redirect → Poll/Webhook.

Step 1: Create Invoice
Endpoint: POST /invoices

Payload (JSON):

amount (number, required): Total in Somoni (e.g., 150.50).

description (string, required): Payment purpose.

order_id (string, required): Your internal unique ID (Idempotent: returns existing invoice if reused).

return_url (string, required): Where the user goes after payment.

lifetime (integer, optional): Invoice validity in seconds (default: 600-1800).

customer_phone (string, optional): Phone without +992. If sent, SmartPay sends an SMS link.

Response:

invoice_uuid: Unique system ID.

payment_link: URL to redirect the customer to.

Step 2: Check Status (Polling)
Endpoint: GET /order/status/{order_id}

Success Status: Charged (indicates successful payment).

4. White-Label Card Payment
For a seamless UI where the user pays via a branded card form or iframe.

Endpoint: POST /payment/session

Payload: Identical to /invoices but adds language (ru|en) and name (payer FIO).

Response: Returns session_id and a payment_link specifically for the card gateway.

5. White-Label Deeplinks (Mobile Banking)
Allows users to open local banking apps (Alif, Eskhata, etc.) directly.

Get Banks: GET /merchant/banks to retrieve a list of supported deeplink_bank_ids.

Create Invoice with Bank: POST /invoices adding deeplink_bank_id: {id}.

Response: Returns a deeplink_url to be opened on the client's mobile device.

6. Card Binding & Recurring Payments
Requires manual activation by SmartPay support.

Bind Card: POST /customers/setup

Input: customer_ref (your user ID), return_url.

Output: setup_url (Redirect user here to enter card details).

Charge Saved Card: POST /customers/charge

Input: customer_ref, amount.

Subscriptions: POST /subscriptions

Input: customer_ref, amount, billing_day (1-31), description.

Statuses: active, paused, payment_failed, cancelled.

7. Webhooks (Async Notifications)
Configure in Dashboard → Settings → Webhooks.

Verification: SmartPay sends a 64-character hex token in the X-Api-Token header and a signature (HMAC-SHA256) of the payload.

Payload Structure:

JSON
{
  "payment_date": "2024-04-01T10:00:00",
  "amount": 150.00,
  "order_id": "YOUR_ORDER_ID",
  "invoice_uuid": "...",
  "bank": "Alif Bank",
  "status": "Charged"
}
8. Key Objects Reference
Status Code	Meaning
Created	Invoice generated, waiting for payment.
Charged	Payment successful.
Expired	Time limit exceeded.
Rejected	Payment failed or canceled by user.
9. Health Check
Endpoint: GET /health

Usage: Verify connection and retrieve your merchant_unit_uuid.

Agent Instructions:

Use the Sandbox URL for all initial logic tests.

Implement Idempotency by ensuring order_id is unique per transaction.

Always verify the HMAC signature on webhooks to prevent spoofing.

For mobile-first apps, prioritize the Deeplink flow for better conversion.