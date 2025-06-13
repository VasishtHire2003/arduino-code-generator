import React, { useState, useEffect } from 'react';
// Firebase Imports
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    signInAnonymously // For initial anonymous sign-in if __initial_auth_token is not available
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    addDoc,
    query,
    where,
    orderBy, // Note: orderBy is generally avoided for simple queries as it requires indexes, but included for completeness if sorting is truly needed. For simple history, sorting by a timestamp field would be common.
    onSnapshot,
    serverTimestamp // To store the timestamp of code generation
} from 'firebase/firestore';

// Main App component
const App = () => {
    // --- Application State ---
    const [selectedComponent, setSelectedComponent] = useState('');
    const [description, setDescription] = useState('');
    const [generatedCode, setGeneratedCode] = useState('');
    const [isLoading, setIsLoading] = useState(false); // For Gemini API call
    const [error, setError] = useState(null);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [codeHistory, setCodeHistory] = useState([]); // Stores generated code history from Firestore

    // --- Authentication State ---
    const [user, setUser] = useState(null); // Firebase authenticated user object
    const [isLoadingAuth, setIsLoadingAuth] = useState(true); // Tracks if auth state is still loading
    const [authError, setAuthError] = useState(null); // Auth specific errors
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoginMode, setIsLoginMode] = useState(true); // Toggle between login/signup forms
    const [userId, setUserId] = useState(null); // The authenticated user's UID or anonymous ID

    // --- Firebase Initialization ---
    // Access global variables provided by the Canvas environment for Firebase config
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = typeof __firebase_config !== 'undefined'
        ? JSON.parse(__firebase_config)
        : {
            // Default/fallback config if running outside Canvas for local testing
            apiKey: "YOUR_FIREBASE_API_KEY", // Replace with your actual Firebase API Key if testing locally outside Canvas
            authDomain: "your-project-id.firebaseapp.com",
            projectId: "your-project-id",
            storageBucket: "your-project-id.appspot.com",
            messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
            appId: "YOUR_FIREBASE_APP_ID"
        };

    const firebaseApp = initializeApp(firebaseConfig);
    const auth = getAuth(firebaseApp);
    const db = getFirestore(firebaseApp);

    // --- Firebase Auth State Listener ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                setUserId(currentUser.uid); // Set UID for authenticated users
                setAuthError(null);
            } else {
                // If no user is logged in, try to sign in anonymously with provided token (for Canvas)
                // or just sign in anonymously if no token exists (for local or new anonymous sessions)
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(auth, __initial_auth_token);
                    } else {
                        await signInAnonymously(auth);
                    }
                    // After anonymous sign-in, onAuthStateChanged will trigger again with the anonymous user
                } catch (anonError) {
                    console.error("Anonymous sign-in failed:", anonError);
                    setAuthError("Failed to sign in anonymously. Please try again.");
                }
                setUserId(crypto.randomUUID()); // Generate a random ID for unauthenticated sessions
                setUser(null); // Ensure user is null if not authenticated
            }
            setIsLoadingAuth(false);
        });

        // Cleanup the listener when the component unmounts
        return () => unsubscribe();
    }, [auth]); // Re-run effect if auth object changes

    // --- Firestore Data Listener for Code History ---
    useEffect(() => {
        let unsubscribeFirestore = () => {}; // Initialize as a no-op function

        // Only fetch history if Firebase and a user are ready and it's a non-anonymous user
        if (!isLoadingAuth && user && !user.isAnonymous) {
            setAuthError(null); // Clear auth errors once user is properly authenticated
            const userHistoryCollectionRef = collection(db, `artifacts/${appId}/users/${user.uid}/generatedCode`);
            
            // Note: orderBy is commented out as it requires indexes and might cause issues.
            // Data will be sorted in memory if needed.
            const q = query(userHistoryCollectionRef /*, orderBy('timestamp', 'desc')*/);

            unsubscribeFirestore = onSnapshot(q, (snapshot) => {
                const history = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                // Sort in memory if orderBy is not used in query
                history.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
                setCodeHistory(history);
            }, (fsError) => {
                console.error("Error fetching code history:", fsError);
                setError("Failed to load code history.");
            });
        } else if (!isLoadingAuth && user && user.isAnonymous) {
            // Inform anonymous users about login for history
            setError("Log in or sign up to save and view your code history.");
            setCodeHistory([]); // Clear history for anonymous users
        } else if (!isLoadingAuth && !user) {
             // Handle case where no user or anonymous user exists
             setError("You need to log in or sign up to use all features.");
             setCodeHistory([]);
        }


        // Cleanup Firestore listener
        return () => unsubscribeFirestore();
    }, [isLoadingAuth, user, db, appId]); // Depend on auth loading, user object, db instance, and appId

    // --- Authentication Handlers ---
    const handleAuthAction = async (e) => {
        e.preventDefault();
        setAuthError(null);
        setIsLoading(true); // Use global isLoading for auth actions to disable buttons

        try {
            if (isLoginMode) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
            // onAuthStateChanged listener will handle setting user state on success
        } catch (error) {
            console.error("Authentication error:", error);
            // Provide user-friendly error messages
            let message = "An authentication error occurred.";
            if (error.code === 'auth/invalid-email') {
                message = 'Invalid email address.';
            } else if (error.code === 'auth/user-disabled') {
                message = 'This user account has been disabled.';
            } else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                message = 'Invalid email or password.';
            } else if (error.code === 'auth/email-already-in-use') {
                message = 'This email is already in use. Try logging in.';
            } else if (error.code === 'auth/weak-password') {
                message = 'Password should be at least 6 characters.';
            }
            setAuthError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignOut = async () => {
        setAuthError(null);
        setIsLoading(true);
        try {
            await signOut(auth);
            setCodeHistory([]); // Clear history on sign out
        } catch (error) {
            console.error("Sign out error:", error);
            setAuthError("Failed to sign out. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Handles the generation of Arduino code by making an API call to the Netlify Function proxy.
     * Sets loading states, handles success, and manages error messages.
     */
    const handleGenerateCode = async () => {
        // Clear previous outputs and set loading state
        setGeneratedCode('');
        setError(null);
        setIsLoading(true);

        try {
            // Define the URL for your Netlify Function proxy.
            const functionUrl = '/.netlify/functions/generate-arduino-code';

            // Prepare the payload to send to your Netlify Function.
            const functionPayload = {
                selectedComponent,
                description,
                model: "gemini-2.0-flash"
            };

            const response = await fetch(functionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(functionPayload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Netlify Function error: ${response.statusText}`);
            }

            const result = await response.json();

            if (result.generatedCode) {
                setGeneratedCode(result.generatedCode);
                setError(null); // Clear any previous error

                // --- Save to Firestore ---
                if (user && !user.isAnonymous) { // Only save for authenticated users
                    try {
                        await addDoc(collection(db, `artifacts/${appId}/users/${user.uid}/generatedCode`), {
                            component: selectedComponent,
                            description: description,
                            code: result.generatedCode,
                            timestamp: serverTimestamp(), // Use server timestamp for consistency
                            userId: user.uid // Redundant with path, but good for direct query if needed
                        });
                        console.log("Code saved to Firestore successfully!");
                    } catch (fsSaveError) {
                        console.error("Error saving code to Firestore:", fsSaveError);
                        setError("Code generated but failed to save to history.");
                    }
                } else {
                    setError("Code generated. Log in to save it to your history.");
                }

            } else {
                setError("No code received from the proxy function. Please try a different description.");
                setGeneratedCode("");
            }
        } catch (err) {
            console.error("Error generating code via proxy:", err);
            setError(`Failed to generate code: ${err.message || 'An unknown error occurred.'}`);
            setGeneratedCode("");
        } finally {
            setIsLoading(false);
        }
    };

    /**
     * Handles copying the generated code to the clipboard.
     * Uses document.execCommand('copy') for broader compatibility within iframes.
     */
    const handleCopyCode = () => {
        const codeElement = document.getElementById('generated-code-block');
        if (codeElement) {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(codeElement);
            selection.removeAllRanges();
            selection.addRange(range);

            try {
                document.execCommand('copy');
                setShowCopySuccess(true);
                setTimeout(() => setShowCopySuccess(false), 2000);
            } catch (err) {
                console.error('Failed to copy text: ', err);
            } finally {
                selection.removeAllRanges();
            }
        }
    };

    // Determine if the generate button should be disabled
    const isGenerateButtonDisabled = isLoading || !selectedComponent || !description.trim();

    // Render loading state for authentication
    if (isLoadingAuth) {
        return (
            <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center font-sans">
                <div className="flex flex-col items-center">
                    <svg className="animate-spin h-10 w-10 text-purple-500 mb-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span className="text-xl">Loading application...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col font-sans">
            {/* Header */}
            <header className="bg-indigo-900 text-purple-200 p-4 shadow-xl rounded-b-lg">
                <div className="container mx-auto text-center relative">
                    <h1 className="text-3xl font-extrabold tracking-wide">Arduino Code Forge</h1>
                    {user && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center space-x-2 text-sm text-gray-300">
                            {/* Display User ID */}
                            <span className="font-medium hidden md:block">User ID:</span>
                            <span className="font-mono text-xs md:text-sm bg-gray-700 px-2 py-1 rounded-md max-w-[100px] md:max-w-[150px] truncate" title={userId}>
                                {userId}
                            </span>
                            <button
                                onClick={handleSignOut}
                                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-sm font-medium transition-colors duration-200 disabled:opacity-50"
                                disabled={isLoading}
                            >
                                Sign Out
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Main Content Area */}
            <main className="w-full max-w-full mx-auto p-6 flex-grow flex flex-col md:flex-row gap-8 py-8">
                {/* Authentication / Main App Content Conditional Rendering */}
                {!user || user.isAnonymous ? (
                    // --- Authentication Forms ---
                    <section className="bg-gray-800 p-6 rounded-xl shadow-xl w-full max-w-md mx-auto flex flex-col border border-gray-700">
                        <h2 className="text-2xl font-semibold mb-6 text-purple-300 text-center">
                            {isLoginMode ? 'Login' : 'Sign Up'}
                        </h2>
                        {authError && (
                            <div className="bg-red-900 border border-red-700 text-red-300 px-4 py-3 rounded-lg mb-4 text-sm" role="alert">
                                {authError}
                            </div>
                        )}
                        <form onSubmit={handleAuthAction} className="flex flex-col gap-4">
                            <div>
                                <label htmlFor="email" className="block text-lg font-medium text-gray-200 mb-2">Email:</label>
                                <input
                                    type="email"
                                    id="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="block w-full p-3 border border-gray-600 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-gray-700 text-gray-100 transition-colors duration-200"
                                    placeholder="your.email@example.com"
                                />
                            </div>
                            <div>
                                <label htmlFor="password" className="block text-lg font-medium text-gray-200 mb-2">Password:</label>
                                <input
                                    type="password"
                                    id="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="block w-full p-3 border border-gray-600 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-gray-700 text-gray-100 transition-colors duration-200"
                                    placeholder="••••••••"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`w-full py-3 px-6 rounded-xl font-semibold text-white transition duration-300 ease-in-out transform hover:scale-105 active:scale-95
                                    ${isLoading
                                        ? 'bg-indigo-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'}`
                                }
                            >
                                {isLoading ? (
                                    <div className="flex items-center justify-center">
                                        <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Processing...
                                    </div>
                                ) : (
                                    isLoginMode ? 'Login' : 'Sign Up'
                                )}
                            </button>
                        </form>
                        <button
                            onClick={() => setIsLoginMode(!isLoginMode)}
                            className="mt-4 text-purple-300 hover:text-purple-400 transition-colors duration-200 text-sm"
                        >
                            {isLoginMode ? "Don't have an account? Sign Up" : "Already have an account? Login"}
                        </button>
                    </section>
                ) : (
                    // --- Main Application Content (Logged In) ---
                    <>
                        {/* Input Panel */}
                        <section className="bg-gray-800 p-6 rounded-xl shadow-xl md:w-1/2 w-full flex flex-col border border-gray-700">
                            <h2 className="text-2xl font-semibold mb-6 text-purple-300">Generate Code</h2>

                            {/* Component Selection Dropdown */}
                            <div className="mb-6">
                                <label htmlFor="component-select" className="block text-lg font-medium text-gray-200 mb-2">
                                    Select Arduino Component:
                                </label>
                                <div className="relative">
                                    <select
                                        id="component-select"
                                        value={selectedComponent}
                                        onChange={(e) => setSelectedComponent(e.target.value)}
                                        className="block w-full py-2 px-4 border border-gray-600 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 bg-gray-700 text-gray-100 appearance-none pr-8 cursor-pointer transition-colors duration-200"
                                    >
                                        <option value="" disabled>Choose a component...</option>
                                        {arduinoComponents.map((component, index) => (
                                            <option key={index} value={component}>
                                                {component}
                                            </option>
                                        ))}
                                    </select>
                                    {/* Dropdown arrow icon */}
                                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-300">
                                        <svg className="fill-current h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                                        </svg>
                                    </div>
                                </div>
                            </div>

                            {/* Description Input Textarea */}
                            <div className="mb-8 flex-grow">
                                <label htmlFor="description-input" className="block text-lg font-medium text-gray-200 mb-2">
                                    Describe what you want the code to do:
                                </label>
                                <textarea
                                    id="description-input"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="e.g., 'Turn on the LED when a button is pressed', 'Read temperature every 5 seconds and print to serial', 'Control a servo motor with a potentiometer'."
                                    rows="8"
                                    className="block w-full p-4 border border-gray-600 rounded-lg shadow-sm focus:ring-purple-500 focus:border-purple-500 resize-y min-h-[120px] bg-gray-700 text-gray-100 transition-colors duration-200"
                                ></textarea>
                            </div>

                            {/* Generate Button */}
                            <button
                                onClick={handleGenerateCode}
                                disabled={isGenerateButtonDisabled}
                                className={`w-full py-3 px-6 rounded-xl font-semibold text-white transition duration-300 ease-in-out transform hover:scale-105 active:scale-95
                                    ${isGenerateButtonDisabled
                                        ? 'bg-indigo-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'}`
                                }
                            >
                                {isLoading ? (
                                    <div className="flex items-center justify-center">
                                        <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Generating...
                                    </div>
                                ) : (
                                    'Generate Code'
                                )}
                            </button>
                        </section>

                        {/* Output Panel */}
                        <section className="bg-gray-800 p-6 rounded-xl shadow-xl md:w-1/2 w-full flex flex-col border border-gray-700">
                            <h2 className="text-2xl font-semibold mb-6 text-purple-300">Generated Code</h2>

                            {/* Conditional Loading Spinner */}
                            {isLoading && (
                                <div className="flex items-center justify-center h-full text-purple-500">
                                    <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span className="text-lg">Generating code...</span>
                                </div>
                            )}

                            {/* Conditional Error Message */}
                            {error && (
                                <div className="bg-red-900 border border-red-700 text-red-300 px-4 py-3 rounded-lg mb-4" role="alert">
                                    <p className="font-bold">Error!</p>
                                    <p className="text-sm">{error}</p>
                                </div>
                            )}

                            {/* Generated Code Display */}
                            {!isLoading && !error && (
                                <div className="flex-grow relative">
                                    {/* Pre-formatted code block */}
                                    <pre className="bg-gray-950 text-lime-400 p-4 rounded-lg overflow-auto h-full text-sm leading-relaxed whitespace-pre-wrap font-mono">
                                        <code id="generated-code-block">{generatedCode || 'Your generated Arduino code will appear here.'}</code>
                                    </pre>
                                    {/* Copy Button */}
                                    {generatedCode && (
                                        <button
                                            onClick={handleCopyCode}
                                            disabled={!generatedCode}
                                            className={`absolute top-4 right-4 bg-gray-700 hover:bg-gray-600 text-gray-200 py-1 px-3 rounded-md text-sm font-medium transition duration-200 ease-in-out
                                                ${!generatedCode ? 'opacity-50 cursor-not-allowed' : 'shadow-md'}`
                                            }
                                        >
                                            {showCopySuccess ? 'Copied!' : 'Copy Code'}
                                        </button>
                                    )}
                                </div>
                            )}
                        </section>

                        {/* Code History Panel */}
                        <section className="bg-gray-800 p-6 rounded-xl shadow-xl w-full flex flex-col border border-gray-700 mt-8 md:mt-0">
                            <h2 className="text-2xl font-semibold mb-6 text-purple-300">Your Code History</h2>
                            {codeHistory.length === 0 && !user?.isAnonymous && (
                                <p className="text-gray-400">No code generated yet. Your history will appear here after you generate some code!</p>
                            )}
                            {codeHistory.length === 0 && user?.isAnonymous && (
                                <p className="text-yellow-400">Log in or sign up to save and view your code history.</p>
                            )}
                            <div className="flex-grow overflow-y-auto max-h-96 custom-scrollbar">
                                {codeHistory.map((item) => (
                                    <div key={item.id} className="bg-gray-700 p-4 rounded-lg mb-4 border border-gray-600">
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="text-lg font-bold text-gray-100">{item.component}</h3>
                                            {item.timestamp && (
                                                <span className="text-xs text-gray-400">
                                                    {new Date(item.timestamp.toDate()).toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-gray-300 text-sm mb-3 line-clamp-2">{item.description}</p>
                                        <button
                                            onClick={() => setGeneratedCode(item.code)}
                                            className="bg-purple-700 hover:bg-purple-800 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200"
                                        >
                                            View Code
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </main>

            {/* Footer */}
            <footer className="bg-gray-950 text-gray-400 text-center p-4 rounded-t-lg">
                <div className="container mx-auto">
                    <p>&copy; 2025 Arduino Code Forge. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
};

export default App;
