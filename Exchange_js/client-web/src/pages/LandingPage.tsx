import { motion } from 'framer-motion';
import { ArrowRight, Shield, Globe, Zap, Database, Briefcase, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const LandingPage = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const fadeIn = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6 }
  };

  return (
    <div className="min-h-screen flex flex-col font-['Noto_Sans_SC'] bg-brand-secondary text-brand-dark">
      {/* Navigation */}
      <nav className="fixed w-full bg-white/90 backdrop-blur-md shadow-sm z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex-shrink-0 flex items-center gap-2">
              <div className="w-8 h-8 bg-brand-primary rounded-lg flex items-center justify-center text-white font-bold text-xl">
                E
              </div>
              <span className="font-bold text-xl text-brand-primary tracking-tight">EXCHANGE</span>
            </div>
            
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-gray-600 hover:text-brand-primary font-medium transition-colors">Features</a>
              <a href="#services" className="text-gray-600 hover:text-brand-primary font-medium transition-colors">Services</a>
              <Link to="/login" className="px-5 py-2 rounded-full bg-brand-primary text-white font-medium hover:bg-blue-700 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
                Sign In
              </Link>
            </div>

            <div className="md:hidden">
              <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-gray-600 hover:text-brand-primary">
                {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="md:hidden bg-white border-t"
          >
            <div className="px-4 pt-2 pb-6 space-y-2">
              <a href="#features" className="block px-3 py-2 text-base font-medium text-gray-700 hover:text-brand-primary hover:bg-gray-50 rounded-md">Features</a>
              <Link to="/login" className="block w-full text-center mt-4 px-5 py-3 rounded-md bg-brand-primary text-white font-bold">
                Sign In
              </Link>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div 
            initial="initial"
            animate="animate"
            variants={fadeIn}
            className="space-y-8"
          >
            <h1 className="text-5xl sm:text-6xl font-bold leading-tight text-gray-900">
              Unlock the Power of <br/>
              <span className="text-brand-primary">Web 3.0 & Digital Assets</span>
            </h1>
            <p className="text-xl text-gray-600 max-w-lg leading-relaxed">
              Buy, sell, and store digital assets with Exchange. A secure and compliant platform designed for the future of finance.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link to="/trade" className="inline-flex items-center justify-center px-8 py-4 text-lg font-bold rounded-full bg-brand-primary text-white hover:bg-blue-700 transition-all shadow-lg hover:shadow-brand-primary/30 group">
                Get Started
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <button className="inline-flex items-center justify-center px-8 py-4 text-lg font-bold rounded-full border-2 border-gray-200 text-gray-700 hover:border-brand-primary hover:text-brand-primary transition-all bg-white">
                Learn More
              </button>
            </div>
            
            <div className="pt-8 border-t border-gray-100">
              <p className="text-sm text-gray-500 mb-4 font-semibold uppercase tracking-wider">Licensed & Regulated by</p>
              <div className="flex items-center gap-2 text-gray-400 font-mono text-xs bg-gray-100 py-2 px-4 rounded w-fit">
                <Shield size={16} /> Virtual Assets Regulatory Authority (VARA)
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="relative z-10 bg-white rounded-2xl shadow-2xl p-6 border border-gray-100 transform rotate-2 hover:rotate-0 transition-transform duration-500">
              {/* Mock Dashboard UI */}
              <div className="flex justify-between items-center mb-6">
                <div>
                  <div className="text-sm text-gray-500">Total Balance</div>
                  <div className="text-3xl font-bold text-gray-900">$124,592.00</div>
                </div>
                <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">+2.4%</div>
              </div>
              <div className="space-y-4">
                {[
                  { name: 'Bitcoin', symbol: 'BTC', price: '$45,231.50', change: '+1.2%', icon: '₿' },
                  { name: 'Ethereum', symbol: 'ETH', price: '$2,891.20', change: '-0.8%', icon: 'Ξ' },
                  { name: 'Solana', symbol: 'SOL', price: '$124.50', change: '+5.7%', icon: '◎' },
                ].map((coin, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-lg font-bold text-brand-primary">
                        {coin.icon}
                      </div>
                      <div>
                        <div className="font-bold text-gray-900">{coin.name}</div>
                        <div className="text-xs text-gray-500">{coin.symbol}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-gray-900">{coin.price}</div>
                      <div className={`text-xs font-bold ${coin.change.startsWith('+') ? 'text-green-600' : 'text-red-500'}`}>{coin.change}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <Link to="/register" className="w-full block text-center py-3 bg-brand-primary text-white rounded-xl font-bold hover:bg-blue-700 transition-colors">
                  Trade Now
                </Link>
              </div>
            </div>
            
            {/* Decorative Elements */}
            <div className="absolute -top-10 -right-10 w-64 h-64 bg-brand-primary/10 rounded-full blur-3xl -z-10"></div>
            <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-blue-400/10 rounded-full blur-3xl -z-10"></div>
          </motion.div>
        </div>
      </section>

      {/* Backers Section */}
      <section className="py-12 bg-white border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-8">Backed by Global Strategic Investors</p>
          <div className="flex flex-wrap justify-center gap-12 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
             {/* Mock Logos using text for simplicity */}
             <div className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Globe size={24}/> GLOBAL FUND</div>
             <div className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Briefcase size={24}/> VENTURES</div>
             <div className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Database size={24}/> DATA CAP</div>
          </div>
        </div>
      </section>

      {/* Services Grid */}
      <section id="services" className="py-24 bg-brand-secondary">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Explore New Opportunities</h2>
            <p className="text-gray-600 text-lg">Comprehensive financial services tailored for institutions and high-net-worth individuals.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { 
                title: 'OTC Services', 
                desc: 'Experience enhanced liquidity and a bespoke, private service tailored specifically for institutions.',
                icon: <Briefcase className="w-8 h-8 text-brand-primary" />
              },
              { 
                title: 'Institutional', 
                desc: 'Access institutional-grade monthly, advanced API integrations, and secure DTC services.',
                icon: <Database className="w-8 h-8 text-brand-primary" />
              },
              { 
                title: 'Partnerships', 
                desc: 'Empower your clients with the ability to earn digital assets rewards and gain access to portfolios.',
                icon: <Globe className="w-8 h-8 text-brand-primary" />
              }
            ].map((item, i) => (
              <motion.div 
                key={i}
                whileHover={{ y: -5 }}
                className="bg-white p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all border border-gray-100"
              >
                <div className="w-16 h-16 bg-brand-primary/10 rounded-2xl flex items-center justify-center mb-6">
                  {item.icon}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{item.title}</h3>
                <p className="text-gray-600 mb-6 leading-relaxed text-sm">{item.desc}</p>
                <a href="#" className="inline-flex items-center text-brand-primary font-bold text-sm hover:gap-2 transition-all">
                  Learn more <ArrowRight size={16} className="ml-1" />
                </a>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
           <div className="text-center mb-16">
             <h2 className="text-3xl font-bold text-gray-900">Institutional Grade Custody Service</h2>
           </div>
           
           <div className="grid md:grid-cols-3 gap-12 text-center">
             <div className="space-y-4">
               <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                 <Shield size={32} />
               </div>
               <h3 className="text-xl font-bold">Regulated & Licensed</h3>
               <p className="text-gray-600 text-sm">Fully compliant with international regulatory standards.</p>
             </div>
             <div className="space-y-4">
               <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                 <Zap size={32} />
               </div>
               <h3 className="text-xl font-bold">Multisignature Tech</h3>
               <p className="text-gray-600 text-sm">Advanced security protocols to protect your assets.</p>
             </div>
             <div className="space-y-4">
               <div className="mx-auto w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center text-purple-600">
                 <Database size={32} />
               </div>
               <h3 className="text-xl font-bold">1:1 Asset Holding</h3>
               <p className="text-gray-600 text-sm">Your assets are always available and held 1:1.</p>
             </div>
           </div>
        </div>
      </section>

      {/* CTA / Footer */}
      <footer className="bg-gray-900 text-white py-12 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-brand-primary rounded-lg flex items-center justify-center font-bold">E</div>
                <span className="font-bold text-xl">EXCHANGE</span>
              </div>
              <p className="text-gray-400 text-sm">The future of digital asset trading.</p>
            </div>
            <div>
              <h4 className="font-bold mb-4">Services</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white">OTC Services</a></li>
                <li><a href="#" className="hover:text-white">Institutional</a></li>
                <li><a href="#" className="hover:text-white">Custody</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white">About</a></li>
                <li><a href="#" className="hover:text-white">Security</a></li>
                <li><a href="#" className="hover:text-white">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Subscribe</h4>
              <div className="flex">
                <input type="email" placeholder="Email address" className="bg-gray-800 border-none rounded-l-md px-4 py-2 text-sm w-full focus:ring-1 focus:ring-brand-primary" />
                <button className="bg-brand-primary px-4 py-2 rounded-r-md font-bold hover:bg-blue-600 text-sm">Go</button>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-xs text-gray-500">
            © 2026 Exchange Group. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
