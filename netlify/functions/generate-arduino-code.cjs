// netlify/functions/generate-arduino-code.cjs

// Import necessary libraries for Google Generative AI
// This SDK is designed for server-side use and can safely access environment variables
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Changed to require for CommonJS

// This is the main handler for your Netlify Function.
// It will be triggered by HTTP requests to /.netlify/functions/generate-arduino-code
exports.handler = async (event) => {
    // Ensure the request method is POST. Our frontend sends POST requests.
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // Method Not Allowed
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed. This function only accepts POST requests.' }),
        };
    }

    // Retrieve the Gemini API Key from Netlify's environment variables.
    // This key is NOT exposed to the client-side browser.
    const apiKey = process.env.GEMINI_API_KEY;

    // Check if the API key is available. If not, return an internal server error.
    if (!apiKey) {
        console.error('SERVER ERROR: GEMINI_API_KEY environment variable is not set.');
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Server configuration error: API key missing on the server.' }),
        };
    }

    // Initialize the Google Generative AI client with the secure API key.
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        // Parse the request body coming from your React frontend.
        // It's expected to contain 'selectedComponent' and 'description'.
        const { selectedComponent, description, model = "gemini-2.0-flash" } = JSON.parse(event.body);

        // Basic validation for incoming data.
        if (!selectedComponent || !description) {
            console.error('FUNCTION ERROR: Missing selectedComponent or description in request body.');
            return {
                statusCode: 400, // Bad Request
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Missing selectedComponent or description in request body.' }),
            };
        }

        // Construct the prompt using the data received from the frontend.
        const prompt = `Generate Arduino code for a ${selectedComponent} that performs the following: ${description}. Ensure the code is complete, includes setup() and loop() functions, defines necessary pins, and adds clear, concise comments. If the component needs a library (e.g., DHT sensor), include the #include directive and a note about installing the library.`;

        // Get the generative model instance.
        const geminiModel = genAI.getGenerativeModel({ model: model });

        // Generate content using the Gemini API.
        // Added more robust error handling around this critical API call
        let text;
        try {
            const result = await geminiModel.generateContent(prompt);
            const response = await result.response;
            text = response.text(); // Extract the generated text content
        } catch (apiError) {
            console.error('GEMINI API ERROR: Failed to generate content from Gemini API:', apiError.message || apiError);
            // Re-throw or return an error specific to the API call failure
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: `AI generation failed: ${apiError.message || 'Unknown API error'}. Please try again with a different prompt.` }),
            };
        }

        // Return the generated code as a successful response.
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ generatedCode: text }), // Send back the generated code
        };

    } catch (parseError) {
        // This catch block handles errors related to parsing the event body or other initial function logic
        console.error('FUNCTION ERROR: Unhandled error in function execution:', parseError.message || parseError);
        // Return an error response to the frontend.
        return {
            statusCode: 500, // Internal Server Error
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'An unexpected server error occurred. Please try again.' }),
        };
    }
};
