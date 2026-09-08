/**
 * OAuth Callback Page
 * Handles OAuth redirect and completes the authentication flow
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processing OAuth callback...');

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        // Extract parameters from URL
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');

        // Extract provider from path (e.g., /oauth/callback/google)
        const pathParts = window.location.pathname.split('/');
        const provider = pathParts[pathParts.length - 1];

        // Handle OAuth errors
        if (error) {
          const errorMsg = errorDescription || error || 'OAuth authentication failed';
          setStatus('error');
          setMessage(errorMsg);

          // Notify parent window
          if (window.opener) {
            window.opener.postMessage(
              {
                type: 'oauth-error',
                error: errorMsg,
                provider,
              },
              window.location.origin
            );
          }

          // Redirect after delay
          setTimeout(() => {
            if (window.opener) {
              window.close();
            } else {
              navigate('/integrations');
            }
          }, 3000);

          return;
        }

        // Validate required parameters
        if (!code || !state) {
          throw new Error('Missing required OAuth parameters');
        }

        if (!provider) {
          throw new Error('Invalid OAuth callback URL');
        }

        setMessage(`Completing ${provider} authentication...`);

        // Get auth token (from localStorage or context)
        const authToken = localStorage.getItem('authToken');
        if (!authToken) {
          throw new Error('Not authenticated. Please log in first.');
        }

        // Complete OAuth flow
        const response = await fetch(`/api/v1/integrations/${provider}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({ code, state }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to complete OAuth flow');
        }

        const data = await response.json();

        setStatus('success');
        setMessage(`Successfully connected to ${provider}!`);

        // Notify parent window
        if (window.opener) {
          window.opener.postMessage(
            {
              type: 'oauth-success',
              provider,
              data,
            },
            window.location.origin
          );

          // Close popup after short delay
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          // If not in popup, redirect to integrations page
          setTimeout(() => {
            navigate('/integrations');
          }, 2000);
        }
      } catch (error) {
        console.error('OAuth callback error:', error);

        const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred';
        setStatus('error');
        setMessage(errorMsg);

        // Notify parent window
        if (window.opener) {
          window.opener.postMessage(
            {
              type: 'oauth-error',
              error: errorMsg,
            },
            window.location.origin
          );

          setTimeout(() => {
            window.close();
          }, 3000);
        } else {
          setTimeout(() => {
            navigate('/integrations');
          }, 3000);
        }
      }
    };

    handleOAuthCallback();
  }, [searchParams, navigate]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#f5f5f5',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center',
          maxWidth: '400px',
        }}
      >
        {status === 'processing' && (
          <>
            <div
              style={{
                width: '50px',
                height: '50px',
                margin: '0 auto 20px',
                border: '3px solid #f3f3f3',
                borderTop: '3px solid #0066cc',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <style>
              {`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}
            </style>
          </>
        )}

        {status === 'success' && (
          <div
            style={{
              fontSize: '50px',
              marginBottom: '20px',
            }}
          >
            ✓
          </div>
        )}

        {status === 'error' && (
          <div
            style={{
              fontSize: '50px',
              marginBottom: '20px',
              color: '#d32f2f',
            }}
          >
            ✗
          </div>
        )}

        <h2
          style={{
            margin: '0 0 10px',
            fontSize: '20px',
            color: status === 'error' ? '#d32f2f' : '#333',
          }}
        >
          {status === 'processing' && 'Connecting...'}
          {status === 'success' && 'Success!'}
          {status === 'error' && 'Error'}
        </h2>

        <p
          style={{
            margin: 0,
            fontSize: '14px',
            color: '#666',
          }}
        >
          {message}
        </p>

        {status !== 'processing' && (
          <p
            style={{
              margin: '20px 0 0',
              fontSize: '12px',
              color: '#999',
            }}
          >
            This window will close automatically...
          </p>
        )}
      </div>
    </div>
  );
}

export default OAuthCallback;
