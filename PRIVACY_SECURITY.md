# Privacy & Security Notes for Halal Trails

The registration form collects highly sensitive traveler information, including passport identifiers, passport scans, health/mobility information and emergency-contact data.

Before launch:

1. Publish a privacy policy that explains what is collected, why it is needed, who receives it (airlines / visa processor where applicable), and how long it is retained.
2. Limit document access to the minimum number of authorized Halal Trails staff.
3. Do not attach passport or vaccination documents to ordinary email.
4. Use HTTPS everywhere.
5. Keep encryption keys in server-side secrets, never in website JavaScript.
6. Define a deletion schedule after visa processing and trip completion.
7. Keep payment card data entirely inside Stripe Checkout; never accept raw card numbers on the Halal Trails server.
8. Maintain an incident-response contact and a procedure for revoking keys if credentials are exposed.
