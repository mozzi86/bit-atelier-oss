import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Badge } from "@core/components/ui/badge";
import { Bot, User, Send, Loader2 } from "lucide-react";
import { InvokeLLM } from "@core/integrations/Core";

export default function AgentChat({ agents }) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      sender: "agent",
      agent: "Architect Advisor",
      content: "Hello! I'm ready to help you with design reviews, building code compliance, and architectural recommendations. What project would you like me to analyze?",
      timestamp: new Date().toISOString()
    }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("architect_advisor");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      sender: "user",
      content: inputMessage,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    try {
      const selectedAgentData = agents.find(a => a.id === selectedAgent);
      const agentPrompt = `You are ${selectedAgentData.name}, specialized in ${selectedAgentData.specialty}. 
      User question: ${inputMessage}
      
      Provide a helpful, professional response based on your expertise in construction, architecture, and project management.`;

      const response = await InvokeLLM({
        prompt: agentPrompt,
        add_context_from_internet: false
      });

      const agentMessage = {
        id: Date.now() + 1,
        sender: "agent",
        agent: selectedAgentData.name,
        content: response,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => [...prev, agentMessage]);
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        sender: "agent",
        agent: "System",
        content: "Sorry, I encountered an error processing your request. Please try again.",
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[600px]">
      {/* Agent Selection */}
      <div className="lg:col-span-1">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Select AI Agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {agents.map((agent) => {
              const IconComponent = agent.icon;
              return (
                <Button
                  key={agent.id}
                  variant={selectedAgent === agent.id ? "default" : "outline"}
                  className="w-full justify-start h-auto p-3"
                  onClick={() => setSelectedAgent(agent.id)}
                >
                  <div className="flex items-center gap-2">
                    <IconComponent className="w-4 h-4" />
                    <div className="text-left">
                      <div className="font-semibold text-sm">{agent.name}</div>
                      <div className="text-xs opacity-70">{agent.specialty}</div>
                    </div>
                  </div>
                </Button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Chat Interface */}
      <div className="lg:col-span-3">
        <Card className="h-full flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              AI Agent Chat
              <Badge variant="outline">
                {agents.find(a => a.id === selectedAgent)?.name}
              </Badge>
            </CardTitle>
          </CardHeader>
          
          <CardContent className="flex-1 flex flex-col">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-3 max-w-[80%] ${message.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      message.sender === 'user' ? 'bg-blue-500' : 'bg-purple-500'
                    }`}>
                      {message.sender === 'user' ? (
                        <User className="w-4 h-4 text-white" />
                      ) : (
                        <Bot className="w-4 h-4 text-white" />
                      )}
                    </div>
                    <div className={`rounded-2xl p-4 ${
                      message.sender === 'user' 
                        ? 'bg-blue-500 text-white' 
                        : 'bg-slate-100 text-slate-800'
                    }`}>
                      {message.sender === 'agent' && (
                        <div className="text-xs font-semibold mb-1 opacity-70">
                          {message.agent}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex gap-3 justify-start">
                  <div className="flex gap-3 max-w-[80%]">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-500">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                    <div className="rounded-2xl p-4 bg-slate-100 text-slate-800">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Thinking...</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <Input
                placeholder="Ask your AI agent anything..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isLoading}
                className="flex-1"
              />
              <Button 
                onClick={handleSendMessage} 
                disabled={!inputMessage.trim() || isLoading}
                className="px-4"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}