module.exports = async (request, response) => {
    if (request.method !== "POST") {
        response.status(405).json({ error: "Method not allowed." });
        return;
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const environment = process.env.PAYPAL_ENVIRONMENT || "sandbox";

    if (!clientId || !clientSecret) {
        response.status(500).json({ error: "PayPal environment variables are not configured." });
        return;
    }

    try {
        const orderId = String(request.body?.orderID || "");
        if (!/^[A-Z0-9-]+$/i.test(orderId)) {
            response.status(400).json({ error: "Invalid PayPal order." });
            return;
        }

        const api = environment === "production"
            ? "https://api-m.paypal.com"
            : "https://api-m.sandbox.paypal.com";
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const tokenResponse = await fetch(`${api}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "grant_type=client_credentials"
        });
        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok || !tokenData.access_token) {
            throw new Error("PayPal authentication failed.");
        }

        const captureResponse = await fetch(`${api}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "Content-Type": "application/json",
                "PayPal-Request-Id": `capture-${orderId}`
            }
        });
        const data = await captureResponse.json();
        const unit = data.purchase_units?.[0];
        const capture = unit?.payments?.captures?.[0];
        const coins = Number(unit?.custom_id);

        if (!captureResponse.ok || data.status !== "COMPLETED" || capture?.status !== "COMPLETED" || ![400, 1200, 2500, 7000, 20000, 50000].includes(coins)) {
            response.status(502).json({ error: "PayPal payment was not completed." });
            return;
        }

        response.status(200).json({ status: "COMPLETED", coins });
    } catch (error) {
        console.error("PayPal capture order error:", error);
        response.status(500).json({ error: "Could not capture PayPal order." });
    }
};