const COIN_PACKS = {
    400: "0.49",
    1200: "0.99",
    2500: "1.99",
    7000: "4.99",
    20000: "9.99",
    50000: "19.99"
};

// Set these in Netlify Site configuration > Environment variables.
// PAYPAL_CLIENT_ID is safe to expose in the browser, but PAYPAL_CLIENT_SECRET is not.
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_ENVIRONMENT = process.env.PAYPAL_ENVIRONMENT || "sandbox";
const PAYPAL_API = PAYPAL_ENVIRONMENT === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        },
        body: JSON.stringify(body)
    };
}

async function getAccessToken() {
    const credentials = Buffer
        .from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`)
        .toString("base64");
    const result = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });

    const data = await result.json();
    if (!result.ok || !data.access_token) {
        throw new Error("PayPal authentication failed.");
    }
    return data.access_token;
}

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return response(405, { error: "Method not allowed." });
    }

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        return response(500, { error: "PayPal environment variables are not configured." });
    }

    try {
        const body = JSON.parse(event.body || "{}");
        const coins = Number(body.coins);
        const amount = COIN_PACKS[coins];

        if (!amount) {
            return response(400, { error: "Invalid coin package." });
        }

        const token = await getAccessToken();
        const result = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
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
        const data = await result.json();

        if (!result.ok || !data.id) {
            return response(502, { error: "PayPal could not create the order." });
        }

        return response(200, { id: data.id });
    } catch (error) {
        console.error("PayPal create order error:", error);
        return response(500, { error: "Could not create PayPal order." });
    }
};
