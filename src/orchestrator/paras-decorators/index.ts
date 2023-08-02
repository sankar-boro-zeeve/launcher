enum PARA {
    Generic = "generic",
  }
  
  interface ParaDecorator {
    [fn: string]: Function;
  }
  
  // imports
  
  function whichPara(chain: string): PARA {
    return PARA.Generic;
  }
  
  const decorators: { [para in PARA]: { [fn: string]: Function } } = {
    generic: {},
  };
  
  function decorate(para: PARA, fns: Function[]) {
    const decorated = fns.map((fn) => {
      return decorators[para][fn.name] ? decorators[para][fn.name] : fn;
    });
  
    return decorated;
  }
  
  export { whichPara, decorate, PARA };
  