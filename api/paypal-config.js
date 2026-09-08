module.exports = async (request, response) => {
    if (request.method !== "GET") {
        response.status(405).json({ error: "Method not allowed." });
        return;
    }

    response.status(200).json({
        clientId: process.env.PAYPAL_CLIENT_ID || ""
    });
};