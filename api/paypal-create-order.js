const COIN_PACKS = {
    400: "0.49",
    1200: "0.99",
    2500: "1.99",
    7000: "4.99",
    20000: "9.99",
    50000: "19.99"
};

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
        const coins = Number(request.body?.coins);
        const amount = COIN_PACKS[coins];

        if (!amount) {
            response.status(400).json({ error: "Invalid coin package." });
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

        const orderResponse = await fetch(`${api}/v2/checkout/orders`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "Content-Type": "application/json",
                "PayPal-Request-Id": `coins-${coins}-${Date.now()}`
            },
            body: JSON.stringify({
                intent: "CAPTURE",
                purchase_units: [{
                    custom_id: String(coins),
                    description: `${coins.toLocaleString("en-US")} Many Offline Games coins`,
                    amount: { currency_code: "EUR", value: amount }
                }]
            })
        });
        const orderData = await orderResponse.json();

        if (!orderResponse.ok || !orderData.id) {
            response.status(502).json({ error: "PayPal could not create the order." });
            return;
        }

        response.status(200).json({ id: orderData.id });
    } catch (error) {
        console.error("PayPal create order error:", error);
        response.status(500).json({ error: "Could not create PayPal order." });
    }
};