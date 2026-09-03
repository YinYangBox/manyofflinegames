// The PayPal Client Secret must only exist in Netlify environment variables.
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
        const orderID = String(JSON.parse(event.body || "{}").orderID || "");
        if (!/^[A-Z0-9-]+$/i.test(orderID)) {
            return response(400, { error: "Invalid PayPal order." });
        }

        const token = await getAccessToken();
        const result = await fetch(`${PAYPAL_API}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "PayPal-Request-Id": `capture-${orderID}`
            }
        });
        const data = await result.json();
        const unit = data.purchase_units?.[0];
        const capture = unit?.payments?.captures?.[0];
        const coins = Number(unit?.custom_id);

        if (!result.ok || data.status !== "COMPLETED" || capture?.status !== "COMPLETED" || ![400, 1200, 2500, 7000, 20000, 50000].includes(coins)) {
            return response(502, { error: "PayPal payment was not completed." });
        }

        return response(200, { status: "COMPLETED", coins });
    } catch (error) {
        console.error("PayPal capture order error:", error);
        return response(500, { error: "Could not capture PayPal order." });
    }
};
