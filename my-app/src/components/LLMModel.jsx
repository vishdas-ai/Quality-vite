import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Send, ChevronDown, ChevronUp, MessageSquare, Database, Info, HelpCircle } from 'lucide-react';

const API_URL = 'http://localhost:8000'; // Update this if your API URL is different

const HighlightNumbers = ({ children }) => {
  if (typeof children !== 'string') return children;
  const words = children.split(' ');
  return (
    <span>
      {words.map((word, index) => (
        /^-?\d*\.?\d+$/.test(word) 
          ? <span key={index} className="font-bold text-blue-600">{word} </span>
          : word + ' '
      ))}
    </span>
  );
};

const ChatbotLoadingAnimation = () => (
  <div className="flex items-center justify-start p-2">
    <div className="typing-indicator">
      {[...Array(3)].map((_, i) => <span key={i}></span>)}
    </div>
  </div>
);

const LLMModel = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [moreInfoLoading, setMoreInfoLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e, questionText = null) => {
    e && e.preventDefault();
    const queryText = questionText || input;
    if (!queryText.trim()) return;

    setMessages(prev => [...prev, { type: 'user', content: queryText }, { type: 'loading' }]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/process-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText }),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      
      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          type: 'bot',
          content: data.answer || 'No answer provided',
          details: {
            searchMethod: data.search_method,
            tableUsed: data.table_name,
            results: data.results,
            cust_conc_cds: data.results.codes,
            ccc_codes: data.results.codes
          }
        }
      ]);
    } catch (error) {
      console.error('Detailed error:', error);
      setMessages(prev => [
        ...prev.slice(0, -1),
        { type: 'bot', content: `Error: ${error.message}. Please try again.` }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleMoreInformation = async (tableUsed, codes) => {
    setMoreInfoLoading(true);

    try {
      const requestBody = { 
        table_name: tableUsed,
        codes: codes
      };

      const response = await fetch(`${API_URL}/api/more-information`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      
      setMessages(prev => prev.map(msg => 
        msg.details && msg.details.searchMethod === 'vector_search' 
          ? {
              ...msg,
              details: {
                ...msg.details,
                moreInfo: data
              }
            }
          : msg
      ));
    } catch (error) {
      console.error('More information error:', error);
      // Handle error (e.g., show an error message to the user)
    } finally {
      setMoreInfoLoading(false);
    }
  };

  const QuestionTile = ({ question, icon, color }) => (
    <Card 
      className={`cursor-pointer hover:shadow-xl transition-all duration-300 ${color} text-white overflow-hidden group`}
      onClick={(e) => handleSubmit(e, question)}
    >
      <CardContent className="p-4 relative">
        <div className="absolute top-2 right-2 text-white opacity-70 group-hover:opacity-100 transition-opacity duration-300">
          {icon}
        </div>
        <h3 className="text-sm font-semibold mb-1 pr-8">{question}</h3>
        <p className="text-xs text-white opacity-80 group-hover:opacity-100 transition-opacity duration-300">Click to ask</p>
        <div className="absolute bottom-1 right-1 opacity-10 group-hover:opacity-20 transition-opacity duration-300">
          <HelpCircle size={32} />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col h-screen bg-cover bg-center" style={{backgroundImage: 'url("/ford-webpage.png")'}}>
      <style jsx>{`
        .typing-indicator {
          display: flex;
          align-items: center;
        }
        .typing-indicator span {
          height: 8px;
          width: 8px;
          margin: 0 2px;
          background-color: #60A5FA;
          display: block;
          border-radius: 50%;
          opacity: 0.4;
          animation: 1s pulse infinite;
        }
        .typing-indicator span:nth-of-type(2) { animation-delay: 0.3s; }
        .typing-indicator span:nth-of-type(3) { animation-delay: 0.6s; }
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.2); opacity: 1; }
        }
        .message-transition {
          transition: all 0.3s ease-in-out;
        }
        .message-transition:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
      `}</style>
      
      <header className="bg-black bg-opacity-50 text-white p-4 flex justify-between items-center">
        <img src="/Ford_logo_flat.png" alt="Ford logo" className="h-10 w-auto" />
        <h1 className="text-3xl font-bold tracking-tight">Warranty Assistant</h1>
        <img src="/google-cloud-logo.svg" alt="Google Cloud logo" className="h-10 w-auto" />
      </header>
      
      <div className="flex-grow overflow-auto p-4">
        <div className="h-full flex flex-col space-y-4">
          {messages.map((message, index) => (
            <div key={index} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.type === 'loading' ? (
                <ChatbotLoadingAnimation />
              ) : (
                <div className={`relative max-w-[70%] p-3 rounded-lg shadow-md border message-transition ${
                  message.type === 'user'
                    ? 'bg-blue-600 text-white border-blue-400'
                    : 'bg-white bg-opacity-95 text-gray-800 border-gray-200'
                }`}>
                  {message.type === 'bot' && (
                    <div className="flex items-center mb-2">
                      <img src="/gemini-logo.png" alt="Gemini logo" className="h-6 w-6 mr-2" />
                      <span className="font-bold text-lg text-blue-600">Gemini</span>
                    </div>
                  )}
                  <ReactMarkdown 
                    rehypePlugins={[rehypeRaw]} 
                    components={{ p: HighlightNumbers }}
                    className="text-left text-sm leading-relaxed"
                  >
                    {message.content}
                  </ReactMarkdown>
                  {message.details && (
                    <div className="mt-2 text-xs space-y-2">
                      <div className="flex items-center space-x-1 text-blue-700">
                        <Database className="h-4 w-4" />
                        <p className="font-semibold">Search: {message.details.searchMethod}</p>
                      </div>
                      <div className="flex items-center space-x-1 text-blue-700">
                        <Info className="h-4 w-4" />
                        <p className="font-semibold">Table: {message.details.tableUsed}</p>
                      </div>
                      
                      {message.details.searchMethod === 'vector_search' && (
                        <>
                          <Button 
                            onClick={() => handleMoreInformation(
                              message.details.tableUsed,
                              message.details.tableUsed === 'warranty_embedding'
                                ? message.details.cust_conc_cds
                                : message.details.ccc_codes
                            )}
                            disabled={moreInfoLoading}
                            className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white shadow-md transition duration-300 ease-in-out transform hover:scale-105 rounded-md py-1 text-xs font-semibold"
                          >
                            {moreInfoLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1 inline" />
                            ) : (
                              <MessageSquare className="h-4 w-4 mr-1 inline" />
                            )}
                            {moreInfoLoading ? 'Fetching...' : 'Get More Information'}
                          </Button>
                          {message.details.moreInfo && (
                            <div className="mt-4 bg-white bg-opacity-90 p-3 rounded-md">
                              <h4 className="font-bold text-sm mb-2">Overall Summary:</h4>
                              <p className="text-xs mb-2">{message.details.moreInfo.overall_summary}</p>
                              <h4 className="font-bold text-sm mb-2">Concern Code Summaries:</h4>
                              {Object.entries(message.details.moreInfo.concern_code_summaries || {}).map(([code, summary]) => (
                                <div key={code} className="mb-2">
                                  <h5 className="font-semibold text-xs">Code {code}:</h5>
                                  <p className="text-xs">{summary}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="p-4 bg-black bg-opacity-50 space-y-4">
        {messages.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <QuestionTile 
              question="What are the top 5 customer concern codes with high labor cost?" 
              icon={<Database size={20} />}
              color="bg-gradient-to-br from-blue-500 to-blue-600"
            />
            <QuestionTile 
              question="What are the issues with sunroof leakage?" 
              icon={<Info size={20} />}
              color="bg-gradient-to-br from-green-500 to-green-600"
            />
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about warranty information..."
            className="flex-grow shadow-inner text-sm bg-white bg-opacity-20 border-none placeholder-gray-200 text-white rounded-md py-2 px-3"
          />
          <Button 
            type="submit"
            disabled={loading} 
            className="bg-blue-600 hover:bg-blue-700 text-white shadow-md px-3 py-2 rounded-md transition duration-300 ease-in-out"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default LLMModel;