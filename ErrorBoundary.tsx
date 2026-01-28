import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
    };
  }

  public static getDerivedStateFromError(_: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo, hasError: true });
    console.error("Uncaught error in React component tree:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', margin: '20px', textAlign: 'center', backgroundColor: '#fff3cd', border: '1px solid #ffeeba', color: '#856404', borderRadius: '8px' }}>
          <h1 style={{ fontSize: '24px', marginBottom: '10px' }}>Oops! Something went wrong.</h1>
          <p style={{ marginBottom: '10px' }}>We're sorry, the application encountered an unexpected error.</p>
          {this.state.error &&
            <details style={{ 
              whiteSpace: 'pre-wrap', 
              marginTop: '15px', 
              textAlign: 'left', 
              maxHeight: '250px', 
              overflowY: 'auto', 
              border: '1px solid #ddd', 
              padding: '10px', 
              background: '#f9f9f9',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px'
            }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '5px' }}>Error Details (for developers)</summary>
              {this.state.error.toString()}
              <br />
              {this.state.errorInfo?.componentStack}
            </details>
          }
          <p style={{ marginTop: '20px', fontSize: '14px' }}>
            Please try <button onClick={() => window.location.reload()} style={{color: '#007bff', textDecoration: 'underline', background: 'none', border: 'none', padding: '0', cursor: 'pointer'}}>refreshing the page</button>. 
            If the problem persists, please check the browser's developer console for more specific error messages.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;