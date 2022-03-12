- All objects that go in yaml should use snake_case. 
    - Reason: we want something that is both easy for the user and maps directly in our code. 
      Spaces and kebab-case don't play well with javascript and camel is less readable for the user.  
    
# Project design
- At the moment the admin interface was designed to be completely separated from the normal frontend for the following reasons
  - heavy separation improves security, as it's more unlikely for a bug in the frontend to expose admin commands
  - people interested in building a new frontend won't have to deal with the complexity and features of the admin interface
  - it's easier to keep the frontend smaller for faster load

  Of course this comes with a price to pay on the programmer's side, more work to do.  

# Syntax
- For strings, I'm trying to use double-quotes or backticks for text that's read by the user, and single-quotes elsewhere.  

# Known problems
- react-scripts server doesn't seem to play nicely with SSE, like sockets are left open
