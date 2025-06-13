// netlify/functions/generate-arduino-code.js

// Import necessary libraries for Google Generative AI
// This SDK is designed for server-side use and can safely access environment variables
import { GoogleGenerativeAI } from '@google/generative-ai';

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
        console.error('GEMINI_API_KEY environment variable is not set.');
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Server configuration error: API key missing.' }),
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
        const result = await geminiModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text(); // Extract the generated text content

        // Return the generated code as a successful response.
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ generatedCode: text }), // Send back the generated code
        };

    } catch (error) {
        // Log the error for server-side debugging.
        console.error('Error in Netlify function:', error);

        // Return an error response to the frontend.
        return {
            statusCode: 500, // Internal Server Error
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to generate code via proxy. Please try again.' }),
        };
    }
};
