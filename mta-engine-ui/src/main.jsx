import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Guard against browser translation extensions (e.g. Chrome Google Translate) or
// third-party map libraries mutating DOM nodes and triggering React's
// "Failed to execute 'removeChild' on 'Node'" error.
if (typeof Node === 'function' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function (child) {
    if (child && child.parentNode !== this) {
      if (child.parentNode) {
        return originalRemoveChild.call(child.parentNode, child)
      }
      return child
    }
    return originalRemoveChild.apply(this, arguments)
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      return this.appendChild(newNode)
    }
    return originalInsertBefore.apply(this, arguments)
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
