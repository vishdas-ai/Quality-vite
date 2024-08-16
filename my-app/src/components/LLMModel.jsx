import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';

const API_URL = ''; // Update this if your API URL is different

const HighlightNumbers = ({ children }) => {
  if (typeof children !== 'string') {
    return children;
  }

  const words = children.split(' ');
  return (
    <span>
      {words.map((word, index) => {
        const isNumber = /^-?\d*\.?\d+$/.test(word);
        return isNumber ? (
          <span key={index} className="font-bold text-blue-600">
            {word}{' '}
          </span>
        ) : (
          word + ' '
        );
      })}
    </span>
  );
};

const ChatbotLoadingAnimation = () => (
  <div className="flex items-center justify-start p-4">
    <div className="typing-indicator">
      <span></span>
      <span></span>
      <span></span>
    </div>
  </div>
);

const LLMModel = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [moreInfoLoading, setMoreInfoLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { type: 'user', content: input };
    setMessages(prev => [...prev, userMessage, { type: 'loading' }]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/process-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: input }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      const botMessage = {
        type: 'bot',
        content: data.answer || 'No answer provided',
        details: {
          searchMethod: data.search_method,
          tableUsed: data.table_name,
          results: data.results,
          cust_conc_cds: data.results.cust_conc_cds
        }
      };
      
      setMessages(prev => [...prev.slice(0, -1), botMessage]);
    } catch (error) {
      console.error('Detailed error:', error);
      const errorMessage = {
        type: 'bot',
        content: `Error: ${error.message}. Please try again.`
      };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleMoreInformation = async (tableUsed, cust_conc_cds) => {
    setMoreInfoLoading(true);
    setMessages(prev => [...prev, { type: 'loading' }]);

    try {
      const response = await fetch(`${API_URL}/api/more-information`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ table_name: tableUsed, cust_conc_cds: cust_conc_cds }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      const moreInfoMessage = {
        type: 'bot',
        content: 'Here is more detailed information:',
        details: {
          overallSummary: data.overall_summary,
          concernCodeSummaries: data.concern_code_summaries,
          additionalResults: data.additional_results
        }
      };
      
      setMessages(prev => [...prev.slice(0, -1), moreInfoMessage]);
    } catch (error) {
      console.error('More information error:', error);
      const errorMessage = {
        type: 'bot',
        content: `Error fetching more information: ${error.message}. Please try again.`
      };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
    } finally {
      setMoreInfoLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <style jsx>{`
        .typing-indicator {
          display: flex;
          align-items: center;
        }
        .typing-indicator span {
          height: 10px;
          width: 10px;
          float: left;
          margin: 0 1px;
          background-color: #9E9EA1;
          display: block;
          border-radius: 50%;
          opacity: 0.4;
        }
        .typing-indicator span:nth-of-type(1) {
          animation: 1s blink infinite 0.3333s;
        }
        .typing-indicator span:nth-of-type(2) {
          animation: 1s blink infinite 0.6666s;
        }
        .typing-indicator span:nth-of-type(3) {
          animation: 1s blink infinite 0.9999s;
        }
        @keyframes blink {
          50% {
            opacity: 1;
          }
        }
      `}</style>
      <header className="bg-blue-700 text-white p-4 flex justify-between items-center shadow-md">
        <img src="public/Ford_logo_flat.png" alt="Ford logo" className="h-10 w-auto" />
        <h1 className="text-3xl font-bold">Warranty Bot</h1>
        <img src="public/google-cloud-logo.svg" alt="Google Cloud logo" className="h-10 w-auto" />
      </header>
      
      <div className="flex-grow overflow-auto p-4">
        <Card className="h-full flex flex-col shadow-xl">
          <div className="flex-grow overflow-auto p-4 space-y-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.type === 'loading' ? (
                  <ChatbotLoadingAnimation />
                ) : (
                  <div
                    className={`relative max-w-[80%] p-4 rounded-lg shadow-md border ${
                      message.type === 'user'
                        ? 'bg-blue-500 text-white border-blue-600'
                        : 'bg-white text-gray-800 border-gray-200'
                    }`}
                  >
                    {message.type === 'bot' && (
                      <div className="flex items-center mb-3">
                        <img src="public/gemini-logo.png" alt="Gemini logo" className="h-6 w-6 mr-2" />
                        <span className="font-bold text-lg">Gemini</span>
                      </div>
                    )}
                    <ReactMarkdown 
                      rehypePlugins={[rehypeRaw]} 
                      components={{
                        p: ({ children }) => <HighlightNumbers>{children}</HighlightNumbers>
                      }}
                      className="text-left text-sm"
                    >
                      {message.content}
                    </ReactMarkdown>
                    {message.details && (
                      <div className="mt-4 text-xs">
                        <p className="font-semibold">Search Method: {message.details.searchMethod}</p>
                        <p className="font-semibold">Table Used: {message.details.tableUsed}</p>
                        
                        <details className="mt-4">
                          <summary className="cursor-pointer text-blue-500 hover:text-blue-600">View Raw Results</summary>
                          <pre className="bg-gray-100 p-2 rounded-md overflow-x-auto mt-2 text-xs text-left">
                            {JSON.stringify(message.details.results || message.details.additionalResults, null, 2)}
                          </pre>
                        </details>

                        {message.details.searchMethod === 'vector_search' && message.details.cust_conc_cds && (
                          <Button 
                            onClick={() => handleMoreInformation(message.details.tableUsed, message.details.cust_conc_cds)}
                            disabled={moreInfoLoading}
                            className="mt-4 w-full bg-green-500 hover:bg-green-600 text-white shadow-lg"
                          >
                            {moreInfoLoading ? 'Loading More Info...' : 'Get More Information'}
                          </Button>
                        )}
                        
                        {message.details.overallSummary && (
                          <div className="mt-4 bg-gray-100 p-3 rounded-md">
                            <h4 className="font-bold text-sm mb-2">Overall Summary:</h4>
                            <ReactMarkdown className="text-xs">{message.details.overallSummary}</ReactMarkdown>
                          </div>
                        )}
                        {message.details.concernCodeSummaries && (
                          <div className="mt-4">
                            <h4 className="font-bold text-sm mb-2">Concern Code Summaries:</h4>
                            {Object.entries(message.details.concernCodeSummaries).map(([code, summary]) => (
                              <div key={code} className="mt-2 bg-gray-100 p-2 rounded-md">
                                <h5 className="font-semibold text-xs mb-1">Code {code}:</h5>
                                <ReactMarkdown className="text-xs">{summary}</ReactMarkdown>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          
          <form onSubmit={handleSubmit} className="p-4 bg-white border-t flex space-x-2 shadow-md">
            <Input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about warranty information..."
              className="flex-grow shadow-sm"
            />
            <Button type="submit" disabled={loading} className="bg-blue-500 hover:bg-blue-600 text-white shadow-sm">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};

export default LLMModel;